"""Local development authentication for Thread."""
import hashlib
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "thread_auth.sqlite3"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
password_hash = PasswordHash.recommended()
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
SESSION_DAYS = 7


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
    )""")
    conn.commit()
    return conn


def token_digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def utc_now():
    return datetime.now(timezone.utc)


def current_user(request: Request):
    token = request.cookies.get("thread_session")
    if not token:
        return None
    with connect() as conn:
        row = conn.execute("""SELECT u.id, u.email, u.name FROM sessions s
            JOIN users u ON u.id=s.user_id
            WHERE s.token_hash=? AND s.expires_at>?""",
            (token_digest(token), utc_now().isoformat())).fetchone()
    return dict(row) if row else None


def issue_session(response: Response, user_id: int):
    token = secrets.token_urlsafe(32)
    expiry = (utc_now() + timedelta(days=SESSION_DAYS)).isoformat()
    with connect() as conn:
        conn.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
                     (token_digest(token), user_id, expiry))
        conn.commit()
    response.set_cookie(
        key="thread_session", value=token, httponly=True,
        secure=os.getenv("THREAD_COOKIE_SECURE", "false").lower() == "true",
        samesite="lax", max_age=SESSION_DAYS * 86400, path="/",
    )


class Signup(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)


class Login(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup", status_code=201)
def signup(body: Signup, response: Response):
    email = str(body.email).strip().lower()
    hashed = password_hash.hash(body.password)
    try:
        with connect() as conn:
            cursor = conn.execute("INSERT INTO users(email,name,password_hash,created_at) VALUES (?,?,?,?)",
                                  (email, body.name.strip(), hashed, utc_now().isoformat()))
            user_id = cursor.lastrowid
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    issue_session(response, user_id)
    return {"user": {"id": user_id, "email": email, "name": body.name.strip()}}


@router.post("/login")
def login(body: Login, response: Response):
    email = str(body.email).strip().lower()
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not password_hash.verify(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    issue_session(response, row["id"])
    return {"user": {"id": row["id"], "email": row["email"], "name": row["name"]}}


@router.get("/me")
def me(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return {"user": user}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("thread_session")
    if token:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_digest(token),))
            conn.commit()
    response.delete_cookie("thread_session", path="/", samesite="lax")
    return {"ok": True}
