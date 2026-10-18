# Flick

開いた瞬間にメモでき、カードを指でフリックしてステータスを動かすタスク管理 Web アプリ。Cloudflare Workers 上で動きます。

- **メモ**：起動直後からメモ欄にフォーカス。JS の読み込み前に打った文字も失われません。Enter で追加、2 行目以降は詳細メモ。書きかけは下書きとして保持。
- **フリック**：右へ＝次のステータス（未着手 → 進行中 → 完了）、左へ＝前に戻す（未着手では削除）。どれも「元に戻す」可能。
- **AI（Workers AI）**：メモを複数のタスクに分解／音声メモの文字起こし。
- **ログイン**：Google のみ。未ログインでも端末内で使え、ログインするとアカウントへ引き継いで同期。
- **オフライン**：PWA。オフラインで書いた内容は再接続時に同期。

## 技術選定と理由

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| 実行基盤 | **Cloudflare Workers**（Static Assets 同居） | 指定どおり Cloudflare。画面（静的ファイル）と API を 1 つの Worker で配信でき、同一オリジンなので CORS 不要・Cookie 認証が単純。世界中のエッジで動くため初回表示が速い。 |
| データベース | **Cloudflare D1** | Workers から追加設定なしで使える SQLite。タスク・ユーザー・セッションは関係データで、ユーザー単位の絞り込みやトランザクション的な一括反映（`batch`）が必要なため KV より適する。 |
| API | **Hono** | Workers 向けに作られた軽量ルーター（依存ほぼゼロ）。Cookie・セキュリティヘッダーのミドルウェアが標準で揃い、型も効く。 |
| 認証 | **Google OAuth 2.0（認可コード + PKCE）を Arctic で実装** | Google のみという要件に対し、Auth.js などの汎用ライブラリは過剰。Arctic は Workers で動く小さな OAuth クライアントで、PKCE と state 検証を確実に実装できる。セッションは D1 に**ハッシュ化したトークン**を保存し、HttpOnly / Secure / SameSite=Lax の Cookie（HTTPS では `__Host-` 接頭辞）で管理。 |
| AI | **Workers AI**：`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（タスク分解・JSON モード）、`@cf/openai/whisper-large-v3-turbo`（文字起こし） | 指定どおり Workers AI。Llama 3.3 70B は JSON モード（スキーマ指定の構造化出力）対応が公式に明記されており、日本語の要約・分解に十分な品質。Whisper turbo は日本語の音声入力に強い。モデル名は `wrangler.jsonc` の `vars` で差し替え可能。1 ユーザー 1 日 60 回の上限で課金の暴走を防止。 |
| 画面 | **Svelte 5 + Vite**（SPA） | 「開いた瞬間にメモ」を最優先し、ランタイムの小さい Svelte を選択（JS は gzip 約 31KB）。トランジション・ばね（`Spring`）・FLIP（`animate:flip`）が標準で入っており、アニメーションを多用しても追加ライブラリ不要。 |
| ジェスチャー | **自前の Pointer Events 実装** | フリックはアプリの核なので、方向ロック（縦スクロールと競合しない）、速度判定、無効方向のゴムのような抵抗、しきい値での触覚フィードバックを細かく制御するため。ライブラリ分のサイズも削減。 |
| デザイン | **CSS の `backdrop-filter` による Liquid Glass** | 白ベースの背景に淡い光をゆっくり漂わせ、ガラス面がそれを屈折させる構成。縁のハイライトと下辺の照り返しで厚みを表現。Safari / Chrome 双方で動く CSS のみで実装。`prefers-reduced-motion` ではアニメーションを抑制。 |
| スケルトン | **index.html に直書き** | JS の読み込み・データ取得を待たずに全画面スケルトンを描画。メモ欄だけは最初から本物の入力欄で、起動後にアプリへ内容とフォーカスを引き継ぐ。 |
| オフライン | **localStorage + 差分キュー + Service Worker** | 端末内に即保存して即描画（楽観的更新）、変更はキューに積んで `/api/sync` で一括反映。競合は更新時刻の新しい方を採用（LWW）。 |
| テスト | **Playwright**（実ブラウザ・モバイル端末エミュレーション） | 実際のタッチイベントでフリックを検証できる。ローカルの Workers ランタイム（workerd + ローカル D1）に対して実行。 |
| CI / デプロイ | **GitHub Actions + Wrangler** | push ごとに型チェックと E2E を実行し、合格したら D1 マイグレーション → デプロイ。 |

## セキュリティ

- シークレット（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`）は **Workers のシークレット**で管理。リポジトリには含めない。
- 状態を変更するリクエストは Origin が一致するときのみ受け付け（CSRF 対策）。
- CSP・X-Frame-Options などのセキュリティヘッダーを付与。
- タスクは `(user_id, id)` を主キーにし、他ユーザーのデータを参照・上書きできない構造。
- 開発用ログインと AI モックは `DEV_MODE=1` **かつ** `localhost` のときだけ有効（本番には `DEV_MODE` を設定しない）。

## ローカル開発

```bash
npm install
cp .dev.vars.example .dev.vars   # Google のクライアント ID / シークレットを記入
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Workers AI はリモート実行のみのため、ローカルで AI を実際に呼ぶには Cloudflare へのログイン（`npx wrangler login`）が必要です。テスト用の `e2e` 環境では AI バインディングを外し、モックで動作します。

## テスト

```bash
npx playwright install chromium
printf 'DEV_MODE=1\n' > .dev.vars
npm run test:e2e
```

## デプロイ

1. Cloudflare の API トークンを作成（Workers Scripts 編集 / D1 編集 / Workers AI 読み取り / Account Settings 読み取り）
2. GitHub の Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録すると、main への push で自動デプロイ
3. Google のシークレットを Workers に登録：
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
4. Google Cloud Console の OAuth クライアントに、本番の URL を追加：
   - 承認済みの JavaScript 生成元：`https://<worker>.<subdomain>.workers.dev`
   - 承認済みのリダイレクト URI：`https://<worker>.<subdomain>.workers.dev/auth/callback`

## ライセンス

MIT
