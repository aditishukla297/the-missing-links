#!/usr/bin/env python3
"""Install local-development Thread authentication without replacing ingestion code.
Run from the repository root: python3 setup_thread_auth.py
"""
from pathlib import Path
import shutil
import sys

root = Path.cwd()
backend = root / 'backend'
frontend = root / 'frontend'
main = backend / 'app' / 'main.py'
app = frontend / 'src' / 'App.jsx'
if not (main.exists() and app.exists() and (frontend / 'vite.config.js').exists()):
    sys.exit('Run this script from ~/the-missing-links (backend/app/main.py and frontend/src/App.jsx must exist).')

files = {}
files['backend/app/auth.py'] = r'''"""Local development authentication for Thread."""
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
'''
files['frontend/src/Auth.jsx'] = r'''import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, CheckCircle2 } from "lucide-react";
import "./Auth.css";

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(isSignup ? { name, email, password } : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === "string" ? detail : "Please check your details and try again.");
      }
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  return (
    <div className="thread-auth">
      <section className="auth-left">
        <div className="auth-brand"><span className="auth-logo">t<span>.</span></span><span>thread<span className="auth-brand-dot">.</span></span></div>
        <div className="auth-form-area">
          <div className="auth-kicker"><span className="auth-kicker-dot" /> INCIDENT WORKSPACE</div>
          <h1>{isSignup ? "Create your workspace." : "Welcome back."}</h1>
          <p className="auth-subtitle">{isSignup ? "Get started with a clearer way to investigate incidents." : "Sign in to continue your investigations."}</p>
          <form onSubmit={submit}>
            {isSignup && <label>Full name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" minLength={2} /></label>}
            <label>Work email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></label>
            <label>Password
              <div className="auth-password-wrap">
                <input type={showPassword ? "text" : "password"} required autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 10 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={isSignup ? "At least 10 characters" : "Enter your password"} />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </label>
            {error && <div role="alert" className="auth-error">{error}</div>}
            <button className="auth-submit" disabled={busy} type="submit">{busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
          </form>
          <p className="auth-switch">{isSignup ? "Already have an account?" : "New to Thread?"} <button onClick={() => switchMode(isSignup ? "login" : "signup")}>{isSignup ? "Sign in" : "Create an account"}</button></p>
        </div>
        <footer className="auth-footer"><span>© Thread · The Missing Links</span><span>AIORI 3 · PS-013</span></footer>
      </section>
      <section className="auth-right">
        <div className="auth-preview-label"><span className="auth-preview-line" /> BUILT FOR SMALL INCIDENT RESPONSE TEAMS</div>
        <div className="auth-preview-window">
          <div className="preview-top"><span className="preview-brand">thread<span>.</span></span><span className="preview-top-pill">Workspace overview</span><span className="preview-avatar">ML</span></div>
          <div className="preview-body">
            <div className="preview-sidebar"><div className="preview-nav active">◫ &nbsp; Overview</div><div className="preview-nav">◷ &nbsp; Timeline</div><div className="preview-nav">▤ &nbsp; Evidence</div><div className="preview-nav">▦ &nbsp; Reports</div></div>
            <div className="preview-content"><div className="preview-small">WORKSPACE / OVERVIEW</div><h3>Incident overview</h3><p>A clearer view of your security activity.</p><div className="preview-metrics"><div><small>Events collected</small><strong>—</strong></div><div><small>Open investigations</small><strong>—</strong></div><div><small>Evidence batches</small><strong>—</strong></div></div><div className="preview-table"><div className="preview-table-title">Recent activity <span>Example layout</span></div><div className="preview-table-head">EVENT <span>STATUS</span></div><div className="preview-table-row"><span><i className="preview-dot" /> Authentication event</span><em>Recorded</em></div><div className="preview-table-row"><span><i className="preview-dot purple" /> Evidence received</span><em>Collected</em></div><div className="preview-table-row"><span><i className="preview-dot" /> Timeline updated</span><em>Recorded</em></div></div></div>
          </div>
        </div>
        <div className="auth-preview-copy"><div className="auth-preview-icon"><ShieldCheck size={22} /></div><h2>Clarity when it matters.</h2><p>Collect the evidence. Connect the events. Understand the incident.</p><div className="auth-feature"><CheckCircle2 size={16} /> Traceable evidence collection</div><div className="auth-feature"><CheckCircle2 size={16} /> A timeline your team can follow</div></div>
      </section>
    </div>
  );
}
'''
files['frontend/src/Auth.css'] = r'''/* Scoped auth styling: does not override the existing dashboard. */
.thread-auth{min-height:100vh;display:grid;grid-template-columns:minmax(390px,47%) minmax(0,53%);background:#fff;color:#25232b;font-family:Arial,Helvetica,sans-serif;font-size:15px}
.auth-left{display:flex;flex-direction:column;padding:34px clamp(30px,5vw,86px) 25px;min-height:100vh}
.auth-brand{display:flex;align-items:center;gap:10px;font-size:23px;font-weight:700;letter-spacing:-.9px}.auth-brand-dot,.auth-logo span,.preview-brand span{color:#6842ce}.auth-logo{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#f0eafa;color:#5435a5;font-size:22px}
.auth-form-area{width:min(100%,420px);margin:auto; padding:45px 0}.auth-kicker{display:flex;align-items:center;gap:8px;color:#746e82;font-size:11px;font-weight:700;letter-spacing:1.4px}.auth-kicker-dot{width:7px;height:7px;background:#6842ce;border-radius:50%}.auth-form-area h1{font-size:clamp(29px,3vw,38px);font-weight:700;letter-spacing:-1.4px;line-height:1.2;margin:18px 0 11px}.auth-subtitle{color:#787581;font-size:15px;line-height:1.6;margin:0 0 35px}.auth-form-area form{display:grid;gap:20px}.auth-form-area label{display:grid;gap:9px;font-size:13px;font-weight:600;color:#3b3644}.auth-form-area input{width:100%;height:48px;border:1px solid #dcd9e3;border-radius:8px;padding:0 14px;background:#fff;color:#25232b;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}.auth-form-area input:focus{border-color:#6842ce;box-shadow:0 0 0 3px #6842ce20}.auth-password-wrap{position:relative}.auth-password-wrap input{padding-right:48px}.auth-password-wrap button{position:absolute;right:8px;top:7px;height:34px;width:34px;display:grid;place-items:center;border:0;background:transparent;color:#888291;border-radius:6px}.auth-submit{display:flex;align-items:center;justify-content:center;gap:10px;background:#6842ce;color:white;border:0;border-radius:8px;min-height:48px;font-size:14px;font-weight:600;margin-top:7px;transition:background .15s}.auth-submit:hover{background:#5633b7}.auth-submit:disabled{opacity:.7;cursor:wait}.auth-switch{font-size:14px;text-align:center;color:#77717e;margin-top:27px}.auth-switch button{border:0;background:transparent;color:#6842ce;font-weight:700;padding:3px}.auth-error{background:#fff0f0;color:#9c3131;padding:12px;border-radius:7px;font-size:13px;line-height:1.5}.auth-footer{display:flex;justify-content:space-between;gap:10px;color:#9994a0;font-size:11px}
.auth-right{background:#f7f7fa;border-left:1px solid #eceaf1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:50px clamp(25px,4vw,75px);overflow:hidden}.auth-preview-label{align-self:flex-start;font-size:11px;font-weight:700;letter-spacing:1.1px;color:#8b839b;margin-bottom:23px;display:flex;align-items:center;gap:9px}.auth-preview-line{height:2px;width:23px;background:#6842ce}.auth-preview-window{width:100%;max-width:720px;background:#fff;border:1px solid #e7e4ed;border-radius:12px;box-shadow:0 18px 55px #3a25551a;overflow:hidden;transform:rotate(-1deg)}.preview-top{height:48px;border-bottom:1px solid #ecebf0;display:flex;align-items:center;gap:12px;padding:0 16px}.preview-brand{font-size:17px;font-weight:700;letter-spacing:-.5px;margin-right:auto}.preview-top-pill{font-size:10px;color:#8b8693}.preview-avatar{background:#f0eafa;color:#6842ce;border-radius:7px;padding:7px;font-size:10px;font-weight:700}.preview-body{display:flex;min-height:280px}.preview-sidebar{width:125px;border-right:1px solid #eeedf2;background:#fcfcfd;padding:20px 8px;flex-shrink:0}.preview-nav{padding:9px 8px;font-size:10px;color:#8a8792;border-radius:5px;white-space:nowrap}.preview-nav.active{background:#f1ebfb;color:#6842ce;font-weight:700}.preview-content{padding:20px;flex:1;min-width:0}.preview-small{font-size:9px;color:#a49dab;letter-spacing:1px}.preview-content h3{font-size:20px;margin:10px 0 5px;letter-spacing:-.5px}.preview-content p{font-size:10px;color:#9b95a0;margin:0 0 17px}.preview-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.preview-metrics div{border:1px solid #eceaf0;border-radius:6px;padding:10px}.preview-metrics small{font-size:9px;color:#9993a1;display:block}.preview-metrics strong{font-size:19px;display:block;margin-top:9px}.preview-table{border:1px solid #eceaf0;border-radius:6px;margin-top:14px;overflow:hidden}.preview-table-title{font-size:11px;font-weight:700;padding:11px;display:flex;justify-content:space-between}.preview-table-title span{font-size:9px;font-weight:400;color:#aaa3b1}.preview-table-head{background:#faf9fc;padding:9px 11px;font-size:9px;letter-spacing:.5px;color:#a19ba7;display:flex;justify-content:space-between}.preview-table-row{padding:10px 11px;border-top:1px solid #f1f0f4;font-size:10px;display:flex;justify-content:space-between}.preview-table-row span{display:flex;align-items:center;gap:7px}.preview-table-row em{font-size:9px;font-style:normal;color:#7b7583}.preview-dot{width:6px;height:6px;background:#d49b6c;border-radius:50%;display:inline-block}.preview-dot.purple{background:#6842ce}.auth-preview-copy{align-self:flex-start;margin-top:48px;max-width:480px}.auth-preview-icon{color:#6842ce}.auth-preview-copy h2{font-size:25px;letter-spacing:-.8px;margin:12px 0}.auth-preview-copy p{color:#8a8491;font-size:14px;line-height:1.6;margin:0 0 22px}.auth-feature{display:flex;align-items:center;gap:9px;color:#625c6b;font-size:13px;margin:10px 0}.auth-feature svg{color:#6842ce}
@media(max-width:850px){.thread-auth{grid-template-columns:1fr}.auth-left{min-height:100vh}.auth-right{display:none}}@media(max-width:480px){.auth-left{padding:24px}.auth-footer{font-size:10px}}
'''
files['frontend/src/App.jsx'] = r'''import { useEffect, useState } from "react";
import Auth from "./Auth";
import Dashboard from "./Dashboard";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);
  async function signOut() {
    try {
      const r = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not sign out. Please try again.");
      setUser(null);
    } catch (err) { window.alert(err.message); }
  }
  if (checking) return <div style={{ padding: 48, fontFamily: "Arial, sans-serif" }}>Opening Thread…</div>;
  if (!user) return <Auth onAuthenticated={setUser} />;
  return <><div className="thread-session-bar"><span>Signed in as <strong>{user.name}</strong></span><button onClick={signOut}>Sign out</button></div><Dashboard /></>;
}
'''
files['frontend/src/session.css'] = r'''.thread-session-bar{position:fixed;z-index:100;right:16px;bottom:16px;display:flex;align-items:center;gap:12px;padding:10px 13px;border:1px solid #e6e2ed;border-radius:9px;background:#fff;box-shadow:0 4px 18px #00000015;color:#403a4b;font:13px Arial,sans-serif}.thread-session-bar button{border:1px solid #ddd5ed;background:#f5f1fb;color:#6842ce;border-radius:6px;padding:7px 10px;font-weight:600;cursor:pointer}
'''

# Protect existing timeline endpoint using a small dedicated middleware. Ingestion remains API-key based.
patch = '''\n\n# THREAD_AUTH_V1: local user authentication and timeline access control\nfrom fastapi.responses import JSONResponse as _ThreadJSONResponse\nfrom app.auth import router as _thread_auth_router, current_user as _thread_current_user\n\napp.include_router(_thread_auth_router)\n\n@app.middleware("http")\nasync def _thread_require_login(request, call_next):\n    if request.url.path.startswith("/api/v1/timeline") or request.url.path.startswith("/api/v1/evidence"):\n        if _thread_current_user(request) is None:\n            return _ThreadJSONResponse({"detail": "Sign in required"}, status_code=401)\n    return await call_next(request)\n'''

# Preflight checks before any changes.
if 'THREAD_AUTH_V1' in main.read_text():
    sys.exit('Thread authentication appears to be installed already. No files changed.')
if not (backend / '.venv').exists():
    print('WARNING: backend/.venv not found. Ensure Python dependencies are installed.')
if not (frontend / 'src' / 'Dashboard.jsx').exists():
    shutil.copy2(app, frontend / 'src' / 'Dashboard.jsx')
    print('Preserved original dashboard as frontend/src/Dashboard.jsx')
else:
    print('Existing Dashboard.jsx found; leaving it unchanged')

backup = main.with_suffix('.py.before_thread_auth')
shutil.copy2(main, backup)
for relative, content in files.items():
    dest = root / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding='utf-8')

with main.open('a', encoding='utf-8') as handle:
    handle.write(patch)

# Import session.css once, without disrupting index.css.
entry = frontend / 'src' / 'main.jsx'
entry_text = entry.read_text()
if './session.css' not in entry_text:
    entry.write_text('import "./session.css";\n' + entry_text)

ignore = root / '.gitignore'
ignore_text = ignore.read_text() if ignore.exists() else ''
if 'backend/data/' not in ignore_text:
    ignore.write_text(ignore_text + '\nbackend/data/\n')

print('Thread auth files installed. Existing FastAPI main.py backup:', backup)
print('NEXT: cd backend && .venv/bin/python -m pip install email-validator')
print('Then restart FastAPI and refresh http://localhost:5173/')
