from pathlib import Path
from urllib.parse import quote
from collections import OrderedDict
import hashlib
import uuid
from io import BytesIO
import asyncio
import subprocess
import time
import shutil

from fastapi import FastAPI, File, Form, Request, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from starlette.background import BackgroundTask
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener
import logging

from auth import router as auth_router

BASE = Path(__file__).resolve().parent
UPLOADS = BASE / "uploads"
OUTPUTS = BASE / "outputs"
UPLOADS.mkdir(exist_ok=True)
OUTPUTS.mkdir(exist_ok=True)

app = FastAPI(title="Image Compressor MVP")
app.include_router(auth_router)
logger = logging.getLogger(__name__)
register_heif_opener()

MAX_FILE_SIZE = 100 * 1024 * 1024
MAX_VIDEO_FILE_SIZE = 1024 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
UPLOAD_CHUNK_SIZE = 1024 * 1024
OUTPUT_RETENTION_SECONDS = 60 * 60
IMAGE_COMPRESSION_LIMIT = asyncio.Semaphore(2)
VIDEO_COMPRESSION_LIMIT = asyncio.Semaphore(1)
VIDEO_RATE_LIMIT_WINDOW_SECONDS = 60
VIDEO_RATE_LIMIT_REQUESTS = 3
video_request_times: dict[str, list[float]] = {}
IMAGE_CACHE_TTL_SECONDS = 5 * 60
IMAGE_CACHE_MAX_ENTRIES = 3
IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024
IMAGE_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024
VIDEO_RATE_LIMIT_MAX_TRACKED_HOSTS = 1000
image_cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
image_cache_bytes = 0
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif"}
ALLOWED = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
    "image/bmp", "image/tiff", "image/heic", "image/heif", "image/avif",
    "application/octet-stream",
}
VIDEO_ALLOWED = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/avi",
    "video/x-msvideo",
    "video/mpeg",
    "video/x-ms-wmv",
    "video/3gpp",
    "video/3gpp2",
    "application/octet-stream",
}


OUTPUT_FORMATS = {
    "jpg": ("JPEG", "image/jpeg"),
    "png": ("PNG", "image/png"),
    "webp": ("WEBP", "image/webp"),
    "gif": ("GIF", "image/gif"),
    "bmp": ("BMP", "image/bmp"),
    "tiff": ("TIFF", "image/tiff"),
    "heic": ("HEIF", "image/heic"),
    "avif": ("AVIF", "image/avif"),
}

VIDEO_FORMATS = {
    "mp4": ("video/mp4", "libx264", "aac", "-movflags", "+faststart"),
    "webm": ("video/webm", "libvpx-vp9", "libopus", None, None),
    "mov": ("video/quicktime", "libx264", "aac", "-movflags", "+faststart"),
    "mkv": ("video/x-matroska", "libx264", "aac", None, None),
    "avi": ("video/x-msvideo", "mpeg4", "mp3", None, None),
}


def compressed_filename(original_name: str | None, output_format: str) -> str:
    stem = Path(original_name or "image").stem
    safe_stem = "".join(char if char.isalnum() or char in "-_ ." else "_" for char in stem).strip()
    return f"{safe_stem or 'image'}_compressed.{output_format}"


def quality_settings(output_format: str, compression_percent: int) -> tuple[int, int]:
    if output_format == "jpg":
        quality = max(55, round(95 - compression_percent * 0.4))
        return quality, 95 - quality
    if output_format == "webp":
        quality = max(65, round(95 - compression_percent * 0.3))
        return quality, 95 - quality
    if output_format in {"heic", "avif"}:
        quality = max(35, round(95 - compression_percent * 0.55))
        return quality, 95 - quality
    quality_loss = round((compression_percent / 90) ** 2 * 35)
    return 100, quality_loss


def image_cache_key(path: Path, content_type: str | None, output_format: str, compression_percent: int) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(UPLOAD_CHUNK_SIZE):
            digest.update(chunk)
    return f"{digest.hexdigest()}:{content_type or ''}:{output_format}:{compression_percent}"


def prune_image_cache(now: float | None = None) -> None:
    global image_cache_bytes
    current_time = time.monotonic() if now is None else now
    expired_keys = [
        key for key, (created_at, encoded) in image_cache.items()
        if current_time - created_at >= IMAGE_CACHE_TTL_SECONDS
    ]
    for key in expired_keys:
        _, encoded = image_cache.pop(key)
        image_cache_bytes -= len(encoded)


def get_cached_image(cache_key: str) -> bytes | None:
    prune_image_cache()
    cached = image_cache.pop(cache_key, None)
    if cached is None:
        return None
    created_at, encoded = cached
    image_cache[cache_key] = (created_at, encoded)
    return encoded


def cache_image(cache_key: str, encoded: bytes) -> None:
    global image_cache_bytes
    if len(encoded) > IMAGE_CACHE_MAX_ENTRY_BYTES:
        return
    prune_image_cache()
    previous = image_cache.pop(cache_key, None)
    if previous is not None:
        image_cache_bytes -= len(previous[1])
    image_cache[cache_key] = (time.monotonic(), encoded)
    image_cache_bytes += len(encoded)
    while image_cache and (
        len(image_cache) > IMAGE_CACHE_MAX_ENTRIES or image_cache_bytes > IMAGE_CACHE_MAX_BYTES
    ):
        _, (_, evicted) = image_cache.popitem(last=False)
        image_cache_bytes -= len(evicted)


def read_source_bytes(data: bytes | Path) -> bytes:
    return data if isinstance(data, bytes) else data.read_bytes()


def has_transparency(img: Image.Image) -> bool:
    return "A" in img.getbands() or (img.mode == "P" and "transparency" in img.info)


def prepare_frame_for_format(img: Image.Image, pil_format: str) -> Image.Image:
    if pil_format == "JPEG":
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, "white")
        bg.paste(rgba, mask=rgba.getchannel("A"))
        return bg
    if pil_format == "PNG":
        return img.convert("RGBA") if has_transparency(img) else img.convert("RGB")
    if pil_format in {"GIF", "BMP", "TIFF"}:
        if img.mode in ("P", "L", "RGB", "RGBA"):
            return img
        return img.convert("RGBA") if has_transparency(img) else img.convert("RGB")
    return img.convert("RGBA") if has_transparency(img) else img.convert("RGB")


def encode_animated(
    img: Image.Image,
    data: bytes | Path,
    content_type: str | None,
    output_format: str,
    compression_percent: int,
    source_size: int,
) -> bytes:
    pil_format, mime = OUTPUT_FORMATS[output_format]
    if pil_format not in {"GIF", "WEBP", "PNG"}:
        raise HTTPException(
            400,
            "Animated images can only be exported as GIF, WEBP, or PNG.",
        )
    if compression_percent == 0 and content_type == mime:
        original = read_source_bytes(data)
        if len(original) <= source_size:
            return original

    frames = []
    durations = []
    try:
        for frame_index in range(img.n_frames):
            img.seek(frame_index)
            frames.append(prepare_frame_for_format(img.copy(), pil_format))
            durations.append(img.info.get("duration", 100))
    except EOFError:
        pass
    if not frames:
        raise HTTPException(400, "Uploaded file is not a valid image.")

    save_options: dict = {
        "save_all": True,
        "append_images": frames[1:],
        "duration": durations,
        "loop": img.info.get("loop", 0),
    }
    if pil_format == "GIF":
        save_options["optimize"] = True
        save_options["disposal"] = 2
    elif pil_format == "WEBP":
        save_options["quality"] = max(65, round(95 - compression_percent * 0.3))
        save_options["method"] = 6
    else:  # APNG
        save_options["optimize"] = True

    buffer = BytesIO()
    frames[0].save(buffer, pil_format, **save_options)
    encoded = buffer.getvalue()
    if len(encoded) > source_size and content_type == mime:
        return read_source_bytes(data)
    return encoded


def encode_image(data: bytes | Path, content_type: str | None, output_format: str, compression_percent: int) -> bytes:
    pil_format, mime = OUTPUT_FORMATS[output_format]
    source_size = len(data) if isinstance(data, bytes) else data.stat().st_size
    image_source = BytesIO(data) if isinstance(data, bytes) else data
    with Image.open(image_source) as img:
        if img.width * img.height > MAX_IMAGE_PIXELS:
            raise HTTPException(413, "Image dimensions are too large to process safely.")
        if getattr(img, "is_animated", False) and getattr(img, "n_frames", 1) > 1:
            return encode_animated(img, data, content_type, output_format, compression_percent, source_size)

        img = ImageOps.exif_transpose(img)

        if compression_percent == 0 and content_type == mime and pil_format in {"PNG", "GIF", "BMP", "TIFF"}:
            original = read_source_bytes(data)
            if len(original) <= source_size:
                return original

        img = prepare_frame_for_format(img, pil_format)

        if pil_format == "PNG":
            if compression_percent == 0:
                buffer = BytesIO()
                img.save(buffer, pil_format, optimize=True)
                encoded = buffer.getvalue()
            else:
                color_loss = compression_percent / 90
                quantize_method = Image.Quantize.FASTOCTREE if img.mode == "RGBA" else Image.Quantize.MEDIANCUT
                requested_colors = max(2, round(256 - color_loss**2 * 224))
                buffer = BytesIO()
                img.quantize(colors=requested_colors, method=quantize_method).save(buffer, pil_format, optimize=True)
                encoded = buffer.getvalue()
        elif pil_format in {"GIF", "BMP", "TIFF"}:
            if compression_percent > 0 and img.mode in ("RGB", "RGBA"):
                requested_colors = max(2, round(256 - (compression_percent / 90) ** 2 * 224))
                quantize_method = Image.Quantize.FASTOCTREE if img.mode == "RGBA" else Image.Quantize.MEDIANCUT
                img = img.quantize(colors=requested_colors, method=quantize_method)
            buffer = BytesIO()
            save_options = {"optimize": True} if pil_format == "GIF" else {}
            if pil_format == "TIFF":
                save_options["compression"] = "tiff_lzw"
            img.save(buffer, pil_format, **save_options)
            encoded = buffer.getvalue()
        else:
            initial_quality, _ = quality_settings(output_format, compression_percent)
            quality_floor = 55 if pil_format == "JPEG" else 65
            qualities = tuple(dict.fromkeys((initial_quality, 85, 75, quality_floor)))
            qualities = tuple(sorted(qualities, reverse=True))
            qualities = qualities[qualities.index(initial_quality):]
            encoded = b""
            for quality in qualities:
                save_options = {"quality": quality, "optimize": True}
                if pil_format == "JPEG":
                    save_options["progressive"] = True
                if pil_format == "WEBP":
                    save_options["method"] = 6
                if pil_format in {"HEIF", "AVIF"}:
                    save_options["quality"] = quality
                    save_options["save_all"] = False
                buffer = BytesIO()
                img.save(buffer, pil_format, **save_options)
                encoded = buffer.getvalue()
                if len(encoded) <= source_size or quality == qualities[-1]:
                    break

        if len(encoded) > source_size and content_type == mime:
            return read_source_bytes(data)

    return encoded


def validate_compression(output_format: str, compression_percent: int) -> None:
    if output_format not in OUTPUT_FORMATS:
        raise HTTPException(400, "Unsupported image output format.")
    if not 0 <= compression_percent <= 90:
        raise HTTPException(400, "Compression must be between 0 and 90 percent.")


async def save_upload(file: UploadFile, allowed: set[str], extensions: set[str], max_size: int, message: str) -> tuple[Path, int]:
    extension = Path(file.filename or "").suffix.lower().lstrip(".")
    if file.content_type not in allowed and extension not in extensions:
        raise HTTPException(400, message)
    suffix = f".{extension}" if extension else ".upload"
    path = UPLOADS / f"{uuid.uuid4().hex}{suffix}"
    size = 0
    try:
        with path.open("wb") as destination:
            while chunk := await file.read(UPLOAD_CHUNK_SIZE):
                size += len(chunk)
                if size > max_size:
                    raise HTTPException(413, f"Maximum upload size is {max_size // (1024 * 1024)} MB.")
                await asyncio.to_thread(destination.write, chunk)
        return path, size
    except Exception:
        path.unlink(missing_ok=True)
        raise


async def read_upload(file: UploadFile) -> tuple[Path, int]:
    return await save_upload(file, ALLOWED, IMAGE_EXTENSIONS, MAX_FILE_SIZE, "Unsupported image format.")


async def read_video_upload(file: UploadFile) -> tuple[Path, int]:
    extensions = {"mp4", "webm", "mov", "mkv", "avi", "mpeg", "mpg", "wmv", "3gp", "3g2", "mts", "m2ts"}
    return await save_upload(file, VIDEO_ALLOWED, extensions, MAX_VIDEO_FILE_SIZE, "Unsupported video format.")


def validate_video(output_format: str, compression_percent: int) -> None:
    if output_format not in VIDEO_FORMATS:
        raise HTTPException(400, "Unsupported video output format.")
    if not 0 <= compression_percent <= 90:
        raise HTTPException(400, "Video compression must be between 0 and 90 percent.")


def enforce_video_rate_limit(request: Request) -> None:
    client_host = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent_requests = [
        started_at
        for started_at in video_request_times.get(client_host, [])
        if now - started_at < VIDEO_RATE_LIMIT_WINDOW_SECONDS
    ]
    if len(recent_requests) >= VIDEO_RATE_LIMIT_REQUESTS:
        video_request_times[client_host] = recent_requests
        raise HTTPException(429, "Too many video requests. Please try again shortly.")
    recent_requests.append(now)
    video_request_times[client_host] = recent_requests
    # Prevent unbounded memory growth from many distinct client hosts.
    stale_hosts = [
        host for host, times in video_request_times.items()
        if not times or now - times[-1] >= VIDEO_RATE_LIMIT_WINDOW_SECONDS
    ]
    for host in stale_hosts:
        del video_request_times[host]
    while len(video_request_times) > VIDEO_RATE_LIMIT_MAX_TRACKED_HOSTS:
        oldest_host = min(video_request_times, key=lambda host: video_request_times[host][-1])
        del video_request_times[oldest_host]


def compressed_video_filename(original_name: str | None, output_format: str) -> str:
    stem = Path(original_name or "video").stem
    safe_stem = "".join(char if char.isalnum() or char in "-_ ." else "_" for char in stem).strip()
    return f"{safe_stem or 'video'}_compressed.{output_format}"


def cleanup_old_outputs() -> None:
    cutoff = time.time() - OUTPUT_RETENTION_SECONDS
    for directory in (OUTPUTS, UPLOADS):
        for output in directory.iterdir():
            try:
                if output.is_file() and output.stat().st_mtime < cutoff:
                    output.unlink()
            except OSError:
                logger.warning("Could not clean up temporary file %s", output, exc_info=True)


def encode_video_file(
    data: bytes | Path,
    output_path: Path,
    output_format: str,
    compression_percent: int,
    content_type: str | None = None,
) -> Path:
    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise HTTPException(500, "Video support is not installed. Install imageio-ffmpeg and restart the app.") from exc

    _, video_codec, audio_codec, mov_flag, mov_value = VIDEO_FORMATS[output_format]
    source_size = len(data) if isinstance(data, bytes) else data.stat().st_size
    input_path = data if isinstance(data, Path) else UPLOADS / f"{uuid.uuid4().hex}_video_input"
    if isinstance(data, bytes):
        input_path.write_bytes(data)
    try:
        if compression_percent == 0 and content_type == VIDEO_FORMATS[output_format][0]:
            # Validate the file really is a video before passing it through.
            probe = subprocess.run(
                [
                    imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error",
                    "-i", str(input_path), "-f", "null", "-",
                ],
                capture_output=True, text=True, timeout=120,
            )
            if probe.returncode != 0:
                raise HTTPException(400, "Uploaded file is not a valid video.")
            if isinstance(data, bytes):
                output_path.write_bytes(data)
            else:
                shutil.copyfile(data, output_path)
            return output_path

        command = [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(input_path),
            "-c:v", video_codec,
        ]
        if video_codec in {"libx264", "libvpx-vp9"}:
            crf = round(18 + compression_percent * 0.16) if video_codec == "libx264" else round(24 + compression_percent * 0.18)
            command.extend(["-crf", str(crf)])
            if video_codec == "libx264":
                command.extend(["-preset", "medium"])
            else:
                command.extend(["-b:v", "0", "-row-mt", "1"])
        else:  # mpeg4 and other codecs without CRF support
            video_bitrate = max(200, round(4000 * (1 - compression_percent / 100)))
            command.extend(["-q:v", str(max(2, round(2 + compression_percent * 0.08)))])
        command.extend(["-c:a", audio_codec, "-b:a", "128k"])
        if mov_flag:
            command.extend([mov_flag, mov_value])
        command.append(str(output_path))
        completed = subprocess.run(command, capture_output=True, text=True, timeout=600)
        if completed.returncode != 0 or not output_path.is_file():
            raise HTTPException(400, "Could not process this video. Please check that the file is valid.")
        if output_path.stat().st_size > source_size and content_type == VIDEO_FORMATS[output_format][0]:
            raise HTTPException(422, "This video is already highly compressed. Choose a higher compression level or another format.")
        return output_path
    except subprocess.TimeoutExpired as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(504, "Video processing took too long. Try a shorter or smaller video.") from exc
    except HTTPException:
        output_path.unlink(missing_ok=True)
        raise
    finally:
        if isinstance(data, bytes):
            input_path.unlink(missing_ok=True)


def encode_video(
    data: bytes | Path,
    output_format: str,
    compression_percent: int,
    content_type: str | None = None,
) -> bytes:
    output_path = OUTPUTS / f"{uuid.uuid4().hex}.{output_format}"
    try:
        encode_video_file(data, output_path, output_format, compression_percent, content_type)
        return output_path.read_bytes()
    finally:
        output_path.unlink(missing_ok=True)


async def encode_video_async(
    data: bytes,
    output_format: str,
    compression_percent: int,
    content_type: str | None = None,
) -> bytes:
    return await asyncio.to_thread(encode_video, data, output_format, compression_percent, content_type)

@app.get("/", response_class=HTMLResponse)
def home():
    return (BASE / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/favicon.ico", response_class=FileResponse)
def favicon():
    return FileResponse(BASE / "static" / "favicon.svg", media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/robots.txt", response_class=FileResponse)
def robots():
    return FileResponse(
        BASE / "static" / "robots.txt",
        media_type="text/plain",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/sitemap.xml", response_class=FileResponse)
def sitemap():
    return FileResponse(
        BASE / "static" / "sitemap.xml",
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.post("/estimate")
async def estimate(
    file: UploadFile = File(...),
    output_format: str = Form("jpg"),
    compression_percent: int = Form(50),
):
    validate_compression(output_format, compression_percent)
    data, original_size = await read_upload(file)
    try:
        cache_key = await asyncio.to_thread(
            image_cache_key, data, file.content_type, output_format, compression_percent
        )
        async with IMAGE_COMPRESSION_LIMIT:
            encoded = await asyncio.to_thread(encode_image, data, file.content_type, output_format, compression_percent)
        cache_image(cache_key, encoded)
        return {
            "original_size": original_size,
            "estimated_size": len(encoded),
            "output_format": output_format,
        }
    except UnidentifiedImageError as exc:
        raise HTTPException(400, "Uploaded file is not a valid image.") from exc
    finally:
        data.unlink(missing_ok=True)

@app.post("/compress")
async def compress(
    file: UploadFile = File(...),
    output_format: str = Form("jpg"),
    compression_percent: int = Form(50),
):
    validate_compression(output_format, compression_percent)
    data, original_size = await read_upload(file)

    job_id = uuid.uuid4().hex
    cleanup_old_outputs()
    output = OUTPUTS / f"{job_id}.{output_format}"
    compressed_size = 0

    try:
        cache_key = await asyncio.to_thread(
            image_cache_key, data, file.content_type, output_format, compression_percent
        )
        encoded = get_cached_image(cache_key)
        if encoded is None:
            async with IMAGE_COMPRESSION_LIMIT:
                encoded = await asyncio.to_thread(encode_image, data, file.content_type, output_format, compression_percent)
        await asyncio.to_thread(output.write_bytes, encoded)
        compressed_size = len(encoded)

        return {
            "original_size": original_size,
            "compressed_size": output.stat().st_size,
            "download_url": f"/download/{output.name}?name={quote(compressed_filename(file.filename, output_format))}",
            "output_format": output_format,
            "compression_percent": compression_percent,
            "quality_loss_percent": 0 if compression_percent == 0 and compressed_size >= original_size else quality_settings(output_format, compression_percent)[1],
        }
    except HTTPException:
        output.unlink(missing_ok=True)
        raise
    except UnidentifiedImageError as exc:
        raise HTTPException(400, "Uploaded file is not a valid image.") from exc
    except Exception as exc:
        logger.exception("Could not process image")
        raise HTTPException(500, "Could not process image.") from exc
    finally:
        data.unlink(missing_ok=True)


@app.post("/video-estimate")
async def video_estimate(
    request: Request,
    file: UploadFile = File(...),
    output_format: str = Form("mp4"),
    compression_percent: int = Form(50),
):
    enforce_video_rate_limit(request)
    validate_video(output_format, compression_percent)
    data, original_size = await read_video_upload(file)
    estimate_path = UPLOADS / f"{uuid.uuid4().hex}_video_estimate.{output_format}"
    try:
        async with VIDEO_COMPRESSION_LIMIT:
            await asyncio.to_thread(encode_video_file, data, estimate_path, output_format, compression_percent, file.content_type)
        return {"original_size": original_size, "estimated_size": estimate_path.stat().st_size, "output_format": output_format}
    finally:
        data.unlink(missing_ok=True)
        estimate_path.unlink(missing_ok=True)


@app.post("/video-compress")
async def video_compress(
    request: Request,
    file: UploadFile = File(...),
    output_format: str = Form("mp4"),
    compression_percent: int = Form(50),
):
    enforce_video_rate_limit(request)
    validate_video(output_format, compression_percent)
    data, original_size = await read_video_upload(file)
    cleanup_old_outputs()
    job_id = uuid.uuid4().hex
    output = OUTPUTS / f"{job_id}.{output_format}"
    try:
        async with VIDEO_COMPRESSION_LIMIT:
            await asyncio.to_thread(encode_video_file, data, output, output_format, compression_percent, file.content_type)
        return {
            "original_size": original_size,
            "compressed_size": output.stat().st_size,
            "download_url": f"/download-video/{output.name}?name={quote(compressed_video_filename(file.filename, output_format))}",
            "output_format": output_format,
            "compression_percent": compression_percent,
        }
    except Exception:
        output.unlink(missing_ok=True)
        raise
    finally:
        data.unlink(missing_ok=True)

@app.get("/download/{filename}")
def download(filename: str, name: str = "compressed.jpg"):
    path = (OUTPUTS / filename).resolve()
    output_dir = OUTPUTS.resolve()
    output_format = path.suffix.lower().lstrip(".")
    if path.parent != output_dir or not path.is_file() or output_format not in OUTPUT_FORMATS:
        raise HTTPException(404, "File not found.")
    download_name = Path(name).name
    expected_suffix = f".{output_format}"
    if not download_name.lower().endswith(expected_suffix) or download_name != name:
        download_name = f"compressed{expected_suffix}"
    return FileResponse(
        path,
        media_type=OUTPUT_FORMATS[output_format][1],
        filename=download_name,
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@app.get("/download-video/{filename}")
def download_video(filename: str, name: str = "compressed.mp4"):
    path = (OUTPUTS / filename).resolve()
    output_dir = OUTPUTS.resolve()
    output_format = path.suffix.lower().lstrip(".")
    if path.parent != output_dir or not path.is_file() or output_format not in VIDEO_FORMATS:
        raise HTTPException(404, "Video not found.")
    download_name = Path(name).name
    if download_name != name or not download_name.lower().endswith(f".{output_format}"):
        download_name = f"compressed.{output_format}"
    return FileResponse(
        path,
        media_type=VIDEO_FORMATS[output_format][0],
        filename=download_name,
        background=BackgroundTask(path.unlink, missing_ok=True),
    )
