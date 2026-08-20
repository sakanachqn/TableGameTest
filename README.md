# ココロメーター

ことばから互いの感覚を読み取る、3〜10人向けのブラウザパーティーゲーム集です。ホストが作った4文字のRoom IDまたは招待URLからスマホ・PCで参加できます。

- **ナンバーライン（協力戦）**: 秘密の数字（1〜100）をお題に沿ったことばで表現し、全員を大きい順に並べます。
- **フィーリングレンジ（個人戦）**: 両端にある2つの概念の間から秘密の位置を当て、個人得点を競います。

## 主な機能

- 匿名認証による部屋作成・参加・同一ブラウザ再接続
- Realtime Databaseによる参加者、フェーズ、並び順のリアルタイム同期
- 重複しない秘密数字の配布と本人限定の読み取り
- 60個以上のローカルお題、全員の確認待ち、会話、タッチ対応ドラッグ並べ替え
- 正誤・正しい位置の人数を含む答え合わせ、連続ラウンド
- `onDisconnect`による切断表示、途中参加者の次ラウンド待機
- `?debug=true` を付けたローカル開発用状態パネル
- 部屋作成時のゲーム選択と、参加URLからのゲーム自動判定
- フィーリングレンジ用の121お題、出題者ローテーション、秘密の個人予想、累計ランキング

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
    hostUid, phase, round, theme, createdAt, maxPlayers, gameType
    spectrumTurnsPerPlayer      # フィーリングレンジのみ1または2
  players/{uid}/
    name, hint, joinedAt, connected, ready, eligibleFromRound
  order/{index}: uid
  reveals/{uid}: number       # resultフェーズで本人が公開
  spectrum/
    round, maxRounds, psychicUid, psychicOrder, topic, clue
    guessStatus/{uid}: true
    revealedTargetPosition
    revealedGuesses/{uid}: position
    scores/{uid}, totalGuessDistance/{uid}, guessCounts/{uid}
    lastRoundScores/{uid}, lastSettledRound

roomSecrets/{roomId}/{uid}/
  number                      # 本人だけ読み取り、ホストだけ配布

spectrumPrivate/{roomId}/
  targets/{psychicUid}/{round}: position
  guesses/{uid}/{round}/
    position, locked
```

部屋の通常データは参加者だけが読み取れます。参加前に存在確認するため `meta` だけは認証済みユーザーが読めます。`roomSecrets/{roomId}/{uid}` は対象UID本人だけが読めます。答え合わせへ移ると、各クライアントが自分の数字を `reveals` に書き込み、全員分が揃ってから結果を表示します。

`gameType` がない旧ルームは `number-order` として扱うため、追加前に作成されたルームも従来モードのまま動作します。

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

## フィーリングレンジ

### 基本ルールと状態遷移

各ラウンドで出題者だけが0〜100の秘密位置を確認し、数字を使わずにヒントを公開します。ほかの全員は横長のメーターをタップまたはドラッグし、自分の予想を秘密のまま確定します。回答がそろうとターゲットと全員の予想を一斉公開します。

```text
psychicReveal → clue → guessing → result
       ↑                      │
       └──── 次ラウンド ──────┘

規定ラウンド完了 → gameEnd
```

出題者順はゲーム開始時の参加順で固定し、全員が1回または2回ずつ担当します。同じゲーム内では121件のお題を使い切るまで重複させません。開始後に参加したプレイヤーは開催中のゲームを観戦し、次のゲーム開始時に参加者へ加わります。

### 個人予想と得点

予想位置は確定まで `spectrumPrivate` にある本人専用パスへ保存され、他プレイヤーからは読み取れません。確定後は変更できません。通常画面では具体的な位置の数値を隠し、結果画面でのみ表示します。

予想者はターゲットとの距離で得点します。

| 距離 | 得点 |
|---:|---:|
| 0〜3 | 4 |
| 3超〜7 | 3 |
| 7超〜15 | 2 |
| 15超〜25 | 1 |
| 25超 | 0 |

出題者は、接続中の予想者全員の平均距離でボーナスを得ます。

| 平均距離 | 得点 |
|---:|---:|
| 0〜5 | 3 |
| 5超〜10 | 2 |
| 10超〜18 | 1 |
| 18超 | 0 |

累計得点が同じ場合は、予想を行った全ラウンドの総距離が小さいプレイヤーを上位にします。それも同じ場合は参加順です。

### 結果確定と二重加算防止

全員の確定後、ホストだけが `result` へ進めます。各クライアントは本人の秘密値だけを公開領域へ移し、全員分がそろった時点でホストがRealtime Database Transactionを実行します。`lastSettledRound` が現在ラウンド以上なら更新を中止するため、リロード、複数回描画、ボタン連打が起きても得点を二重加算しません。

### 切断と再接続

- 予想者が切断した場合、その人を現在ラウンドの必要回答者と採点対象から外し、残りの接続中プレイヤーで進行します。
- 出題者がターゲット公開前に切断した場合、ホストに「出題者を交代してやり直す」を表示します。そのラウンドは採点せず、接続中の次の人と新しいお題で再開します。
- ホスト切断時は既存モードと同じく自動移譲せず、再接続を待ちます。
- 同じ匿名UIDでリロードした場合、本人の秘密ターゲット、確定済み予想、現在フェーズ、累計得点をFirebaseから復元します。

## Security Rulesと制約

ルールは全公開設定ではありません。部屋データは参加者、秘密数字・秘密ターゲット・秘密予想は対象本人、ゲーム進行・得点・並び順はホスト、公開値は本人に制限しています。公開ターゲットと予想が秘密領域の値に一致すること、出題者が予想を投稿できないこと、確定後の予想を書き換えられないことも検証します。`gameType` は作成後に変更できません。

ただし、サーバー権限を持つゲームロジックがないクライアント完結構成には次の制約があります。

- ホストは数字の生成・配布者なので、改変したクライアントを使えば配布値を記録できます。
- フィーリングレンジでもホストがターゲットを生成するため、改変クライアントやFirebaseプロジェクト管理者まで含む完全なチート防止はできません。
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
