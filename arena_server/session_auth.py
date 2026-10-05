"""Guest transport authentication for cookie-restricted embedded browsers.

Transport grants are opaque, hashed, expiring guest credentials -- never player
IDs, backend keys or URL query parameters. HTTP uses Authorization; WebSockets
prove the grant in their first data frame before joining the room service.
"""

import re
from typing import Literal

from pydantic import Field

from .models import StrictModel

AUTH_SUBPROTOCOL = "tactical-arena-auth"
TRANSPORT_SECONDS = 24 * 60 * 60
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


class SocketAuthentication(StrictModel):
    type: Literal["authenticate"]
    token: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]{43}$")


def bearer_token(header: str | None) -> str | None:
    if header is None:
        return None
    scheme, separator, token = header.partition(" ")
    if not separator or scheme.lower() != "bearer" or not TOKEN_RE.fullmatch(token):
        raise ValueError("Invalid guest transport authorization.")
    return token
