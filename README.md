# Laboratory Calendar

> **Portfolio / demonstration repository**  
> This is an independently developed, unofficial project. It is not an official product of any university, bus operator, or commercial facility. The timetable included in this public repository is synthetic demo data and must not be used for travel.

研究室の共有モニターと各自の端末で、予定・現在時刻・大学方面の直近バスをまとめて確認できるWebアプリケーションです。

カレンダーを表示するだけでなく、複数端末での予定共有、利用申請と管理者承認、時刻表の運行日判定まで、Python標準ライブラリとVanilla JavaScriptだけで実装しました。

## このプロジェクトで取り組んだこと

- 月間予定、時計、次のバスを1画面に集約した常時表示向けUI
- SQLiteを利用した複数端末間の予定共有
- Cookieセッションによるログインと管理者承認フロー
- 曜日・祝日・学休期・臨時運行日を考慮した次発便の算出
- 外部フレームワークに依存しないHTTPサーバーとREST APIの実装
- ダークモード、キーボード操作、レスポンシブ表示への対応

## 主な機能

### カレンダー

- 月間表示と前月・翌月・今月への移動
- 予定の追加、編集、削除
- 30秒ごとの自動同期
- 旧ローカルデータの初回移行

### アカウント管理

- 新規利用申請
- 管理者による承認・拒否
- 承認済みユーザーのみ予定を編集可能
- 7日間有効なCookieセッション

### バス案内

- 複数路線を想定した合成デモ時刻表
- 「大学発」「大学行き」の切り替え
- 現在時刻から路線ごとの次発便と待ち時間を計算
- 祝日、学休期、通常便、臨時便、運休便の判定

## 技術構成

| 分類 | 使用技術 |
| --- | --- |
| フロントエンド | HTML、CSS、Vanilla JavaScript |
| サーバー | Python `ThreadingHTTPServer` |
| データベース | SQLite |
| 認証 | PBKDF2-SHA256、Cookieセッション |
| テスト | Python標準ライブラリ、Node.js構文検査 |
| 外部依存 | なし |

## アーキテクチャ

```text
Browser
  ├─ Calendar / Clock / Bus UI
  └─ Fetch API
        ↓
Python HTTP Server
  ├─ Static file delivery
  ├─ Authentication / authorization
  ├─ Events API
  └─ Admin API
        ↓
SQLite
  ├─ events
  ├─ users
  └─ sessions
```

バス時刻はブラウザ内のデータから計算するため、画面表示のたびに外部サイトへアクセスしません。予定とユーザー情報だけをサーバーAPIで扱い、役割を分離しています。

## セキュリティ上の工夫

- パスワードはランダムソルト付きPBKDF2-SHA256でハッシュ化
- セッションIDは暗号学的に安全な乱数で生成
- Cookieに`HttpOnly`と`SameSite=Strict`を設定
- IPアドレスとユーザー名単位のログイン試行制限
- SQLはプレースホルダーで実行
- JSON本文、文字数、UUID、日付・時刻形式を検証
- データベースとローカルセキュリティ設定をGit管理から除外
- `data/`やサーバーソースへのHTTPアクセスを拒否

これは学習・ポートフォリオ用途の実装であり、本番運用に必要な安全性を保証するものではありません。本アプリ単体ではHTTPSを終端しません。インターネット上で運用する場合は、HTTPS対応のリバースプロキシまたはVPNとの併用を前提としています。

## ローカルでの起動

Python 3があれば追加パッケージなしで実行できます。

1. 接続を許可するIPアドレスまたはネットワークを設定します。

   ```bash
   python3 server.py --setup-security
   ```

   ローカルPCだけで試す場合は、入力例として`127.0.0.1`を指定できます。

2. 任意で初期管理者パスワードを環境変数に設定します。

   ```bash
   export CALENDAR_ADMIN_PASSWORD='安全なパスワード'
   ```

   未設定の場合は、初回起動時に生成されたパスワードが一度だけ表示されます。

3. サーバーを起動します。

   ```bash
   python3 server.py --host 127.0.0.1 --port 8000
   ```

4. ブラウザで <http://localhost:8000> を開きます。

初回起動で`data/calendar.db`が自動生成されます。`data/`以下には利用者情報や予定が保存されるため、リポジトリには含まれません。

## API概要

| Method | Endpoint | 用途 |
| --- | --- | --- |
| `GET` | `/api/events` | 予定一覧の取得 |
| `POST` | `/api/events` | 予定の追加・更新 |
| `DELETE` | `/api/events/:id` | 予定の削除 |
| `POST` | `/api/signup` | 利用申請 |
| `POST` | `/api/login` | ログイン |
| `POST` | `/api/logout` | ログアウト |
| `GET` | `/api/me` | セッションユーザーの取得 |
| `GET` | `/api/admin/users` | ユーザー一覧の取得 |
| `POST` | `/api/admin/approve` | 利用申請の承認・拒否 |

予定の追加・更新・削除には承認済みユーザー、管理APIには管理者のセッションが必要です。

## テスト

```bash
python3 -m py_compile server.py
node --check app.js
python3 test.py
```

## 設計上の判断と改善候補

学習と要件理解を目的に、フレームワークが隠蔽するHTTP、Cookie、セッション、SQLの処理を標準ライブラリで実装しています。一方、より大規模な公開運用には次の改善が必要です。

- CSRFトークンの追加
- HTTPS終端を含む本番用Webサーバー構成
- 予定更新の競合制御と操作履歴
- 自動テストの拡充とCI導入
- 年度更新しやすい時刻表データ管理

## ディレクトリ構成

```text
.
├── index.html              # 画面構造
├── style.css               # レイアウト、配色、レスポンシブ対応
├── app.js                  # カレンダー、時計、API連携、バス表示
├── timetable-data.js       # 路線別時刻表
├── timetable-periods.js    # 祝日、学休期、臨時運行日
├── server.py               # HTTPサーバー、API、認証・認可
└── test.py                 # 軽量な回帰テスト
```

## 公開データと権利について

公開版の時刻表、停留所名、運行日程はすべて機能確認用の合成デモデータです。実際の交通案内には使用できません。内部運用時に使用した第三者由来の実時刻表や組織固有の日程は、再配布条件を確認できないためこのリポジトリには含めていません。

大学、交通事業者、商業施設などの名称・ロゴを本プロジェクトの権利者または協力者として表示していません。本プロジェクトに明示的なオープンソースライセンスは付与していないため、閲覧を超える複製・改変・再配布の許諾を意味しません。
