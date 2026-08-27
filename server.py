#!/usr/bin/env python3
"""研究室カレンダーの静的配信・共有予定・利用者管理サーバー。"""

import argparse
import base64
import binascii
import collections
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATABASE = DATA_DIR / "calendar.db"
SECURITY_FILE = DATA_DIR / "security.json"
PASSWORD_ITERATIONS = 600_000
MAX_JSON_BYTES = 8_192
SESSION_DAYS = 7
SECURITY = None
FAILED_LOGINS = collections.defaultdict(collections.deque)
FAILED_LOGIN_LOCK = threading.Lock()


def now_utc():
    return datetime.now(timezone.utc)


def timestamp(value=None):
    return (value or now_utc()).isoformat(timespec="seconds")


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(32)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt).decode("ascii")


def verify_password(password, password_hash, password_salt):
    digest, _ = hash_password(password, base64.b64decode(password_salt))
    return hmac.compare_digest(digest, password_hash)


def connect_database():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_database():
    with connect_database() as database:
        database.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
                status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
        """)
        if database.execute("SELECT 1 FROM users WHERE username = 'admin'").fetchone():
            return None
        password = os.environ.get("CALENDAR_ADMIN_PASSWORD")
        generated = not bool(password)
        password = password or secrets.token_urlsafe(18)
        password_hash, password_salt = hash_password(password)
        database.execute(
            "INSERT INTO users VALUES (?, 'admin', ?, ?, 'admin', 'approved', ?)",
            (str(uuid.uuid4()), password_hash, password_salt, timestamp()),
        )
        return password if generated else None


def setup_security():
    print("接続を許可するIPアドレスまたはネットワークを設定します。")
    raw_networks = input("許可IP（カンマ区切り）: ").strip()
    networks = []
    for value in raw_networks.split(","):
        if not value.strip():
            continue
        try:
            networks.append(str(ipaddress.ip_network(value.strip(), strict=False)))
        except ValueError as error:
            raise SystemExit(f"IPアドレスが正しくありません: {value}") from error
    if not networks:
        raise SystemExit("許可IPを1件以上入力してください。")
    config = {"allowed_networks": sorted(set(networks + ["127.0.0.1/32", "::1/128"]))}
    DATA_DIR.mkdir(exist_ok=True)
    temporary_file = SECURITY_FILE.with_suffix(".tmp")
    temporary_file.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary_file, 0o600)
    temporary_file.replace(SECURITY_FILE)
    print(f"セキュリティ設定を保存しました: {SECURITY_FILE}")


def load_security():
    if not SECURITY_FILE.exists():
        raise SystemExit("セキュリティ設定がありません。先に `python3 server.py --setup-security` を実行してください。")
    try:
        config = json.loads(SECURITY_FILE.read_text(encoding="utf-8"))
        config["allowed_networks"] = [ipaddress.ip_network(value, strict=False) for value in config["allowed_networks"]]
        return config
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"セキュリティ設定が壊れています: {SECURITY_FILE}") from error


def validate_event(payload):
    event_id, date, time = str(payload.get("id") or uuid.uuid4()), str(payload.get("date") or ""), str(payload.get("time") or "")
    title, note = str(payload.get("title") or "").strip(), str(payload.get("note") or "").strip()
    try:
        datetime.strptime(date, "%Y-%m-%d")
        if time: datetime.strptime(time, "%H:%M")
        uuid.UUID(event_id)
    except ValueError as error:
        raise ValueError("予定ID、日付または時刻の形式が正しくありません。") from error
    if not title or len(title) > 50: raise ValueError("予定名は1〜50文字で入力してください。")
    if len(note) > 200: raise ValueError("メモは200文字以内で入力してください。")
    return {"id": event_id, "date": date, "time": time, "title": title, "note": note}


def validate_credentials(payload):
    username, password = str(payload.get("username") or "").strip(), str(payload.get("password") or "")
    if not 3 <= len(username) <= 32 or not username.isascii() or not all(char.isalnum() or char in "_-" for char in username):
        raise ValueError("ユーザー名は3〜32文字の英数字、_、-で入力してください。")
    if len(password) < 8 or len(password) > 256:
        raise ValueError("パスワードは8〜256文字で入力してください。")
    return username, password


class CalendarHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def is_allowed_ip(self):
        try: client_ip = ipaddress.ip_address(self.client_address[0])
        except ValueError: return False
        return any(client_ip in network for network in SECURITY["allowed_networks"])

    def authorize_ip(self):
        if self.is_allowed_ip(): return True
        self.send_json({"error": "このIPアドレスからはアクセスできません。"}, HTTPStatus.FORBIDDEN)
        return False

    @staticmethod
    def is_private_path(path):
        path = unquote(path)
        return path == "/server.py" or path.startswith("/data/") or any(
            part.startswith(".") for part in Path(path).parts
        )

    def send_json(self, value, status=HTTPStatus.OK, cookie=None):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cookie: self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_JSON_BYTES: raise ValueError
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict): raise ValueError
            return payload
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError("JSONの形式またはサイズが正しくありません。") from error

    def get_current_user(self):
        cookie = SimpleCookie()
        try: cookie.load(self.headers.get("Cookie", ""))
        except (KeyError, ValueError): return None
        session = cookie.get("session_id")
        if not session or len(session.value) != 64: return None
        with connect_database() as database:
            row = database.execute("""
                SELECT users.id, users.username, users.role, users.status, sessions.session_id, sessions.expires_at
                FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.session_id = ?
            """, (session.value,)).fetchone()
            if not row or datetime.fromisoformat(row["expires_at"]) <= now_utc() or row["status"] != "approved":
                if row: database.execute("DELETE FROM sessions WHERE session_id = ?", (session.value,))
                return None
        return dict(row)

    def require_user(self, admin=False):
        user = self.get_current_user()
        if not user:
            self.send_json({"error": "この操作にはログインおよび管理者承認が必要です。"}, HTTPStatus.UNAUTHORIZED)
            return None
        if admin and user["role"] != "admin":
            self.send_json({"error": "管理者権限が必要です。"}, HTTPStatus.FORBIDDEN)
            return None
        return user

    def is_rate_limited(self, username):
        now = now_utc().timestamp()
        keys = (f"ip:{self.client_address[0]}", f"user:{username.lower()}")
        with FAILED_LOGIN_LOCK:
            for key in keys:
                failures = FAILED_LOGINS[key]
                while failures and failures[0] <= now - 60: failures.popleft()
                if len(failures) >= 5: return True
        return False

    def record_login_failure(self, username):
        now = now_utc().timestamp()
        with FAILED_LOGIN_LOCK:
            for key in (f"ip:{self.client_address[0]}", f"user:{username.lower()}"):
                FAILED_LOGINS[key].append(now)

    def clear_login_failures(self, username):
        with FAILED_LOGIN_LOCK:
            for key in (f"ip:{self.client_address[0]}", f"user:{username.lower()}"):
                FAILED_LOGINS.pop(key, None)

    def do_GET(self):
        if not self.authorize_ip(): return
        path = urlparse(self.path).path
        if path == "/api/events":
            with connect_database() as database:
                rows = database.execute("SELECT id, date, time, title, note FROM events ORDER BY date, time, title").fetchall()
            self.send_json([dict(row) for row in rows]); return
        if path == "/api/health": self.send_json({"status": "ok"}); return
        if path == "/api/me":
            user = self.get_current_user()
            self.send_json({"user": {key: user[key] for key in ("id", "username", "role", "status")} if user else None}); return
        if path == "/api/admin/users":
            if not self.require_user(admin=True): return
            with connect_database() as database:
                rows = database.execute("SELECT id, username, role, status, created_at FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at").fetchall()
            self.send_json([dict(row) for row in rows]); return
        if self.is_private_path(path):
            self.send_error(HTTPStatus.NOT_FOUND); return
        super().do_GET()

    def do_HEAD(self):
        if not self.authorize_ip(): return
        if self.is_private_path(urlparse(self.path).path):
            self.send_error(HTTPStatus.NOT_FOUND); return
        super().do_HEAD()

    def do_POST(self):
        if not self.authorize_ip(): return
        path = urlparse(self.path).path
        try: payload = self.read_json()
        except ValueError as error: self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST); return
        if path == "/api/signup": return self.signup(payload)
        if path == "/api/login": return self.login(payload)
        if path == "/api/logout": return self.logout()
        if path == "/api/admin/approve": return self.approve_user(payload)
        if path == "/api/events":
            if not self.require_user(): return
            try: event = validate_event(payload)
            except ValueError as error: self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST); return
            with connect_database() as database:
                database.execute("""INSERT INTO events (id,date,time,title,note,updated_at) VALUES (?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET date=excluded.date,time=excluded.time,title=excluded.title,note=excluded.note,updated_at=excluded.updated_at""",
                (event["id"], event["date"], event["time"], event["title"], event["note"], timestamp()))
            self.send_json(event, HTTPStatus.CREATED); return
        self.send_error(HTTPStatus.NOT_FOUND)

    def signup(self, payload):
        try: username, password = validate_credentials(payload)
        except ValueError as error: self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST); return
        password_hash, password_salt = hash_password(password)
        try:
            with connect_database() as database:
                database.execute("INSERT INTO users VALUES (?, ?, ?, ?, 'user', 'pending', ?)", (str(uuid.uuid4()), username, password_hash, password_salt, timestamp()))
        except sqlite3.IntegrityError:
            self.send_json({"error": "このユーザー名は既に使用されています。"}, HTTPStatus.CONFLICT); return
        self.send_json({"message": "Account request submitted. Waiting for admin approval.", "status": "pending"}, HTTPStatus.CREATED)

    def login(self, payload):
        try: username, password = validate_credentials(payload)
        except ValueError as error: self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST); return
        if self.is_rate_limited(username): self.send_json({"error": "ログイン試行が多すぎます。1分後に再試行してください。"}, HTTPStatus.TOO_MANY_REQUESTS); return
        with connect_database() as database:
            row = database.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            valid = row and verify_password(password, row["password_hash"], row["password_salt"])
            if not valid: self.record_login_failure(username); self.send_json({"error": "ユーザー名またはパスワードが正しくありません。"}, HTTPStatus.UNAUTHORIZED); return
            if row["status"] != "approved": self.send_json({"error": "このアカウントはまだ承認されていません。"}, HTTPStatus.FORBIDDEN); return
            self.clear_login_failures(username)
            session_id, expires = secrets.token_hex(32), timestamp(now_utc() + timedelta(days=SESSION_DAYS))
            database.execute("DELETE FROM sessions WHERE expires_at <= ?", (timestamp(),))
            database.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (session_id, row["id"], timestamp(), expires))
        cookie = f"session_id={session_id}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS * 86400}"
        self.send_json({"message": "Login successful", "user": {"username": row["username"], "role": row["role"]}}, cookie=cookie)

    def logout(self):
        cookie = SimpleCookie()
        try: cookie.load(self.headers.get("Cookie", ""))
        except (KeyError, ValueError): pass
        session = cookie.get("session_id")
        if session:
            with connect_database() as database: database.execute("DELETE FROM sessions WHERE session_id = ?", (session.value,))
        self.send_json({"message": "Logged out"}, cookie="session_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")

    def approve_user(self, payload):
        if not self.require_user(admin=True): return
        user_id, action = str(payload.get("user_id") or ""), payload.get("action")
        if action not in ("approve", "reject"):
            self.send_json({"error": "操作が正しくありません。"}, HTTPStatus.BAD_REQUEST); return
        try: uuid.UUID(user_id)
        except ValueError: self.send_json({"error": "ユーザーIDが正しくありません。"}, HTTPStatus.BAD_REQUEST); return
        with connect_database() as database:
            cursor = database.execute("UPDATE users SET status = ? WHERE id = ? AND role != 'admin'", ("approved" if action == "approve" else "rejected", user_id))
            if action == "reject": database.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        if not cursor.rowcount: self.send_json({"error": "対象ユーザーが見つかりません。"}, HTTPStatus.NOT_FOUND); return
        self.send_json({"message": "User status updated successfully"})

    def do_DELETE(self):
        if not self.authorize_ip(): return
        if not self.require_user(): return
        path, prefix = urlparse(self.path).path, "/api/events/"
        if not path.startswith(prefix): self.send_error(HTTPStatus.NOT_FOUND); return
        event_id = unquote(path[len(prefix):])
        try: uuid.UUID(event_id)
        except ValueError: self.send_json({"error": "予定IDが正しくありません。"}, HTTPStatus.BAD_REQUEST); return
        with connect_database() as database: cursor = database.execute("DELETE FROM events WHERE id = ?", (event_id,))
        if not cursor.rowcount: self.send_json({"error": "予定が見つかりません。"}, HTTPStatus.NOT_FOUND); return
        self.send_json({"deleted": event_id})


def main():
    parser = argparse.ArgumentParser(description="研究室カレンダー共有サーバー")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--setup-security", action="store_true")
    args = parser.parse_args()
    if args.setup_security: setup_security(); return
    global SECURITY
    SECURITY = load_security()
    generated_password = init_database()
    if generated_password:
        print("初期管理者 admin を作成しました。初期パスワード（この起動時だけ表示）:", generated_password)
        print("次回以降は CALENDAR_ADMIN_PASSWORD を設定してから初回起動することを推奨します。")
    server = ThreadingHTTPServer((args.host, args.port), CalendarHandler)
    print(f"研究室カレンダーを http://{args.host}:{args.port}/ で起動しました")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nサーバーを終了します")
    finally: server.server_close()

if __name__ == "__main__": main()
