"""Real authentication system: SQLite storage + bcrypt hashing + JWT tokens + email verification."""
import os
import random
import re
import smtplib
import sqlite3
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

import bcrypt
from fastapi import APIRouter, HTTPException, Header
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, field_validator

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "users.db"

SECRET_KEY = os.environ.get("AUTH_SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# SMTP settings for verification emails. If unset, codes are returned in the
# API response (development mode only) so the flow stays testable.
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)

VERIFICATION_CODE_TTL_MINUTES = 15
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,20}$")

router = APIRouter(prefix="/auth", tags=["auth"])


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                verification_code TEXT,
                verification_expires TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        # Migrate older databases that lack the newer columns.
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        for column, ddl in (
            ("username", "ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''"),
            ("verified", "ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 1"),
            ("verification_code", "ALTER TABLE users ADD COLUMN verification_code TEXT"),
            ("verification_expires", "ALTER TABLE users ADD COLUMN verification_expires TEXT"),
        ):
            if column not in columns:
                conn.execute(ddl)
        conn.commit()


init_db()
init_db()


def smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def send_verification_email(email: str, username: str, code: str) -> None:
    message = EmailMessage()
    message["Subject"] = "Fast Compress - Verify your account"
    message["From"] = SMTP_FROM
    message["To"] = email
    message.set_content(
        f"Hi {username},\n\n"
        f"Welcome to Fast Compress! Your verification code is:\n\n"
        f"    {code}\n\n"
        f"This code expires in {VERIFICATION_CODE_TTL_MINUTES} minutes.\n"
        "If you did not create this account, you can ignore this email.\n"
    )
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(message)


def generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def store_verification_code(conn: sqlite3.Connection, email: str) -> str:
    code = generate_code()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)).isoformat()
    conn.execute(
        "UPDATE users SET verification_code = ?, verification_expires = ? WHERE email = ?",
        (code, expires, email),
    )
    conn.commit()
    return code


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    payload = {"sub": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(401, "Invalid token.")
        return email
    except JWTError as exc:
        raise HTTPException(401, "Invalid or expired token.") from exc


class SignupRequest(BaseModel):
    email: EmailStr
    username: str
    password: str

    @field_validator("password")
    @classmethod
    def password_length(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Password must be at least 6 characters.")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password is too long (max 72 bytes).")
        return value

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        value = value.strip()
        if not USERNAME_RE.match(value):
            raise ValueError("Username must be 3-20 characters (letters, numbers, _ . -).")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"\d{6}", value):
            raise ValueError("Verification code must be 6 digits.")
        return value


        if not re.fullmatch(r"\d{6}", value):
            raise ValueError("Verification code must be 6 digits.")
        return value


@router.post("/signup")
def signup(body: SignupRequest):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
        if existing and existing["verified"]:
            raise HTTPException(409, "An account with this email already exists.")
        username_taken = conn.execute(
            "SELECT id FROM users WHERE username = ? AND email != ?", (body.username, body.email)
        ).fetchone()
        if username_taken:
            raise HTTPException(409, "This username is already taken.")
        password_hash = hash_password(body.password)
        now = datetime.now(timezone.utc).isoformat()
        if existing:
            conn.execute(
                "UPDATE users SET username = ?, password_hash = ?, created_at = ? WHERE email = ?",
                (body.username, password_hash, now, body.email),
            )
        else:
            conn.execute(
                "INSERT INTO users (email, username, password_hash, verified, created_at) VALUES (?, ?, ?, 0, ?)",
                (body.email, body.username, password_hash, now),
            )
        conn.commit()
        code = store_verification_code(conn, body.email)

    if smtp_configured():
        try:
            send_verification_email(body.email, body.username, code)
        except Exception as exc:
            raise HTTPException(502, "Could not send the verification email. Please try again later.") from exc
        return {"message": "Verification code sent to your email.", "email": body.email, "dev_code": None}

    return {
        "message": "Verification code generated (development mode - no SMTP configured).",
        "email": body.email,
        "dev_code": code,
    }


@router.post("/verify")
def verify(body: VerifyRequest):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
        if not user:
            raise HTTPException(404, "No pending account for this email.")
        if user["verified"]:
            raise HTTPException(409, "This account is already verified. Please log in.")
        if not user["verification_code"] or user["verification_code"] != body.code:
            raise HTTPException(400, "Incorrect verification code.")
        expires = user["verification_expires"]
        if expires and datetime.fromisoformat(expires) < datetime.now(timezone.utc):
            raise HTTPException(400, "Verification code has expired. Please sign up again.")
        conn.execute(
            "UPDATE users SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE email = ?",
            (body.email,),
        )
        conn.commit()
    return {
        "email": body.email,
        "username": user["username"],
        "token": create_token(body.email),
        "message": f"Welcome {user['username']}! Your account is verified.",
    }


@router.post("/resend-code")
def resend_code(body: LoginRequest):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
        if not user or user["verified"]:
            raise HTTPException(404, "No pending verification for this email.")
        code = store_verification_code(conn, body.email)
        username = user["username"]
    if smtp_configured():
        try:
            send_verification_email(body.email, username, code)
        except Exception as exc:
            raise HTTPException(502, "Could not send the verification email. Please try again later.") from exc
        return {"message": "A new verification code was sent.", "dev_code": None}
    return {"message": "A new verification code was generated (development mode).", "dev_code": code}


@router.post("/login")
def login(body: LoginRequest):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password.")
    if not user["verified"]:
        raise HTTPException(403, "Please verify your email first. Check your inbox for the code.")
    return {
        "email": body.email,
        "username": user["username"],
        "token": create_token(body.email),
        "message": "Signed in.",
    }


@router.get("/me")
def me(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token.")
    token = authorization.split(" ", 1)[1]
    email = decode_token(token)
    with get_db() as conn:
        user = conn.execute("SELECT email, username, created_at FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        raise HTTPException(401, "Account not found.")
    return {"email": user["email"], "username": user["username"], "created_at": user["created_at"]}
