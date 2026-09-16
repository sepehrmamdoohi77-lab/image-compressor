import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app, encode_video_file, enforce_video_rate_limit, video_request_times


class CoreBehaviorTests(unittest.TestCase):
    def setUp(self):
        video_request_times.clear()
        self.client = TestClient(app)

    def test_favicon_is_served(self):
        response = self.client.get("/favicon.ico")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/svg+xml")

    def test_video_timeout_is_reported_as_gateway_timeout(self):
        with TemporaryDirectory() as temp:
            source = Path(temp) / "input.mp4"
            output = Path(temp) / "output.mp4"
            source.write_bytes(b"video")
            timeout = subprocess.TimeoutExpired(["ffmpeg"], 600)

            with patch("main.subprocess.run", side_effect=timeout):
                with self.assertRaises(HTTPException) as error:
                    encode_video_file(source, output, "mp4", 50, "video/mp4")

            self.assertEqual(error.exception.status_code, 504)
            self.assertFalse(output.exists())

    def test_video_rate_limit_rejects_fourth_request(self):
        request = type("Request", (), {"client": type("Client", (), {"host": "test-client"})()})()

        for _ in range(3):
            enforce_video_rate_limit(request)

        with self.assertRaises(HTTPException) as error:
            enforce_video_rate_limit(request)

        self.assertEqual(error.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
