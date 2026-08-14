# ココロメーター

秘密の数字（1〜100）を、お題に沿った言葉で表現し、全員を大きい順に並べる会話型ブラウザパーティーゲームです。3〜10人向けで、ホストが作った4文字のRoom IDまたは招待URLからスマホ・PCで参加できます。

## 主な機能

- 匿名認証による部屋作成・参加・同一ブラウザ再接続
- Realtime Databaseによる参加者、フェーズ、並び順のリアルタイム同期
- 重複しない秘密数字の配布と本人限定の読み取り
- 60個以上のローカルお題、全員の確認待ち、会話、タッチ対応ドラッグ並べ替え
- 正誤・正しい位置の人数を含む答え合わせ、連続ラウンド
- `onDisconnect`による切断表示、途中参加者の次ラウンド待機
- `?debug=true` を付けたローカル開発用状態パネル

## 技術構成

- TypeScript（strict） / React / Vite
- Firebase Authentication（Anonymous）
- Firebase Realtime Database
- dnd-kit（マウス・タッチ・キーボード並べ替え）
- Cloudflare Pages（静的SPA）

別のバックエンドサーバーは使用しません。Firebase SDKの処理は `src/services` と `src/hooks` に分離しています。

## セットアップ

Node.js 20.19以上（または22.12以上）を用意し、プロジェクト直下で次を実行します。

```bash
npm install
cp .env.example .env
```

Windows PowerShellでは `Copy-Item .env.example .env` を使用できます。

## Firebaseプロジェクトの準備

1. [Firebase Console](https://console.firebase.google.com/)でプロジェクトを作成します。
2. 「プロジェクトの設定」→「マイアプリ」でWebアプリを追加します。
3. 「Authentication」→「Sign-in method」で **Anonymous（匿名）** を有効にします。
4. 「Realtime Database」からデータベースを作成します。テストモードは使用せず、リージョンは利用者に近い場所を選びます。
5. Firebase CLIへログイン済みなら `firebase use --add` で対象プロジェクトを選び、`firebase deploy --only database` を実行して `firebase/database.rules.json` を反映します。コンソールのRules画面へ同ファイルの内容を貼り付けても構いません。

### `.env`

Webアプリの設定値を `.env` に入れます。

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=...
```

FirebaseのWeb API Keyはクライアントに配布される識別情報であり、アクセス保護はAuthenticationとSecurity Rulesが担います。それでも `.env` はコミット対象外にしています。

## ローカル起動

```bash
npm run dev
```

表示されたURLを開きます。デバッグ情報が必要なら `http://localhost:5173/?debug=true` のようにアクセスします。複数人の確認には、別ブラウザ・プライベートウィンドウ・別端末を使うと匿名UIDが分かれます。

## ビルド

```bash
npm run build
npm run lint
```

成果物は `dist/` に作られます。

## Cloudflare Pagesへのデプロイ

Cloudflare DashboardのWorkers & PagesからGitリポジトリを接続し、以下を設定します。

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: 20.19以上
- Environment variables: `.env` と同じ `VITE_FIREBASE_*` 一式

`public/_redirects` に `/* /index.html 200` があるため、`/room/ABCD` を直接開いてもSPAへ戻り、404になりません。デプロイ先ドメインはFirebase Authenticationの「Authorized domains」に追加してください。

## データ構造

```text
rooms/{roomId}/
  meta/
    hostUid, phase, round, theme, createdAt, maxPlayers
  players/{uid}/
    name, hint, joinedAt, connected, ready, eligibleFromRound
  order/{index}: uid
  reveals/{uid}: number       # resultフェーズで本人が公開

roomSecrets/{roomId}/{uid}/
  number                      # 本人だけ読み取り、ホストだけ配布
```

部屋の通常データは参加者だけが読み取れます。参加前に存在確認するため `meta` だけは認証済みユーザーが読めます。`roomSecrets/{roomId}/{uid}` は対象UID本人だけが読めます。答え合わせへ移ると、各クライアントが自分の数字を `reveals` に書き込み、全員分が揃ってから結果を表示します。

## ゲーム状態遷移

```text
lobby → reveal → discussion → ordering → result
  ↑                                        │
  └──────────── 次のラウンド ─────────────┘
```

- `lobby`: 3人以上でホストが開始。
- `reveal`: 本人だけが数字を確認。全員の確認後、自動で進行。
- `discussion`: 共通のお題で会話。ホストが次へ進行。
- `ordering`: ホストが並べ替え、全員へリアルタイム同期。
- `result`: 各本人が秘密数字を公開し、正解順と位置一致人数を表示。

## 切断・途中参加の仕様

- 接続中は `onDisconnect` を登録し、タブ終了や通信断で `connected=false` にします。プレイヤーレコードを即削除しないため、同じブラウザ（同じ匿名UID）ならニックネームを復元して再接続できます。
- ホスト切断時は全員に警告を出して進行を停止し、ホストの再接続を待ちます。クライアントだけで安全にホスト権限を移譲する競合処理を避けるため、自動移譲はしていません。
- ゲーム中の新規参加者には `eligibleFromRound = 現在ラウンド + 1` を設定し、観戦表示にします。次のラウンド開始時から参加します。
- 切断者は次ラウンド開始時の数字配布対象から除外されます。ラウンド途中の切断者は再接続を待ちます。

## Security Rulesと制約

ルールは全公開設定ではありません。部屋データは参加者、秘密数字は本人、ゲーム進行と並び順はホスト、公開数字は本人に制限しています。また公開値が本人の秘密数字と一致することを検証します。

ただし、サーバー権限を持つゲームロジックがないクライアント完結構成には次の制約があります。

- ホストは数字の生成・配布者なので、改変したクライアントを使えば配布値を記録できます。
- ホストの操作順序や最低人数など、UI側の制約の一部は悪意ある改変クライアントから完全には守れません。
- 匿名認証のため、ブラウザデータを消すと別プレイヤーとして扱われます。
- result中に参加者が戻らない場合、その人の数字を公開できないため結果待ちになります。
- 古い部屋の自動削除はありません。本番運用ではFirebase Extensions、Scheduled Functions、または手動での定期削除を検討してください。

賞品やランキングが絡む用途でチート耐性が必要なら、Cloud Functions等の信頼できるサーバー側で乱数生成と状態遷移を行う設計へ拡張してください。

## 今後追加できる機能

- Firebase Cloud Functionsによる安全な配布・ホスト移譲・古い部屋削除
- ホストによるお題カテゴリ選択、カスタムお題
- 制限時間、スコア、連勝、効果音
- PWA、QRコード招待、多言語化
- 切断者をホストが除外してラウンドを続ける機能

## クレジット

- 効果音素材：OtoLogic
