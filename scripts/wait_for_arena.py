"""Bounded CI readiness check, not a fake service response."""

import time
import urllib.request

if __name__ == "__main__":
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:5173/arena/api/ready", timeout=2
            ) as response:
                if response.status == 200:
                    break
        except (OSError, TimeoutError):
            time.sleep(0.3)
    else:
        raise SystemExit("Actual Arena server/frontend did not become ready within 25 seconds")
