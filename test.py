"""軽量な回帰テスト。実行: python3 test.py"""

import tempfile
from pathlib import Path

import server


def main():
    original_data_dir, original_database = server.DATA_DIR, server.DATABASE
    try:
        with tempfile.TemporaryDirectory() as directory:
            server.DATA_DIR = Path(directory)
            server.DATABASE = server.DATA_DIR / "calendar.db"
            initial_password = server.init_database()
            assert initial_password
            with server.connect_database() as database:
                admin = database.execute("SELECT role, status FROM users WHERE username = 'admin'").fetchone()
                assert dict(admin) == {"role": "admin", "status": "approved"}
            event = server.validate_event({"id": "d839f533-4119-4671-9b93-d8601d7ceef4", "date": "2026-08-01", "time": "09:00", "title": "ゼミ", "note": ""})
            assert event["title"] == "ゼミ"
            try:
                server.validate_credentials({"username": "invalid name", "password": "12345678"})
            except ValueError:
                pass
            else:
                raise AssertionError("不正なユーザー名を受け入れました")
            try:
                server.validate_credentials({"username": "管理者", "password": "12345678"})
            except ValueError:
                pass
            else:
                raise AssertionError("ASCII以外のユーザー名を受け入れました")
    finally:
        server.DATA_DIR, server.DATABASE = original_data_dir, original_database
    print("server unit tests: OK")


if __name__ == "__main__":
    main()
