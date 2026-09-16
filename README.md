# Image Compressor MVP

## Run locally
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Open http://127.0.0.1:8000

در صفحه می‌توانید تصاویر JPG، PNG، WEBP، GIF، BMP، TIFF، HEIC و AVIF را فشرده یا به فرمت دیگری تبدیل کنید. سقف تصویر ۱۰۰ مگابایت و سقف ویدیو ۱ گیگابایت است. نام فایل اصلی حفظ می‌شود و پسوند `_compressed` به آن اضافه خواهد شد.

بخش ویدیو فرمت‌های رایج ورودی را با FFmpeg می‌خواند و خروجی MP4، WEBM، MOV، MKV و AVI تولید می‌کند. برای پردازش آن وابستگی `imageio-ffmpeg` نصب می‌شود. حجم مجاز ویدیو ۱ گیگابایت است.

## Deploy
Push this folder to GitHub and connect the repository to a hosting provider that supports Python web services.
