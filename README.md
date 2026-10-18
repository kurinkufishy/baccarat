# 仲間内バカラ

架空チップで友達と遊ぶ、ライブディーラー風のオンラインバカラ。

- 画面は **GitHub Pages**（`web/`）
- ログインは **Googleアカウントのみ**（Firebase Authentication）
- シャッフル・配り・精算・入金は全部 **Cloud Functions** がやる。ブラウザはFirestoreを読むだけで、書き込みはルールで全面禁止
- 山札はサーバー専用の場所にあって、誰にも見えない

```
web/                  GitHub Pages に出る画面（index.html / app.js / style.css / firebase-config.js）
functions/            Cloud Functions（index.js = 窓口、game.js = ルールと配当）
firestore.rules       Firestore のセキュリティルール
.github/workflows/    Pages への自動デプロイと、サーバーロジックのテスト
```

---

## はじめのセットアップ（1回だけ）

### 1. Firebase プロジェクトを作る
1. https://console.firebase.google.com で「プロジェクトを追加」（Google アナリティクスはオフでOK）
2. 出てきた **プロジェクトID** を `.firebaserc` の `PASTE_PROJECT_ID` に書く

### 2. Blaze プランにして、予算アラートを付ける
Cloud Functions は Blaze（従量課金）プランが必要。友達どうしの規模なら無料枠に収まるはずだけど、念のため上限の通知を付けておく。
1. コンソール左下の「アップグレード」→ Blaze
2. Google Cloud コンソール →「お支払い」→「予算とアラート」で、例えば月 100 円の予算アラートを作る

### 3. Google ログインを有効にする
1. 「Authentication」→「始める」→「Sign-in method」→ **Google** を有効化
2. 「設定」→「承認済みドメイン」に **`kurinkufishy.github.io`** を追加

### 4. Firestore を作る
「Firestore Database」→「データベースを作成」→ 本番環境モード、ロケーションは **asia-northeast1（東京）**

### 5. ウェブアプリの設定値を貼る
1. 「プロジェクトの設定」→「マイアプリ」→ ウェブ（`</>`）でアプリを登録（Hosting はチェック不要）
2. 表示された `firebaseConfig` の中身を **`web/firebase-config.js`** に貼る
   （この値は公開されても大丈夫。守っているのはルールと関数のほう）

### 6. サーバー（関数とルール）をデプロイ
PC に Node.js 22 を入れてから、リポジトリのフォルダで:

```bash
npm install -g firebase-tools
firebase login
cd functions && npm ci && cd ..
firebase deploy --only functions,firestore
```

初回は必要な Google Cloud の API が自動で有効になるので数分かかる。
「コンテナイメージの削除ポリシーを設定する？」と聞かれたら **Yes**（古いビルドが溜まって課金されるのを防ぐ）。

### 7. GitHub Pages を有効にする
1. GitHub のリポジトリ →「Settings」→「Pages」→ Source を **GitHub Actions** にする
2. `main` に push すると自動で公開される
3. URL は `https://kurinkufishy.github.io/<リポジトリ名>/`

---

## 招待した人だけにする（おすすめ）

何もしなければ、Google アカウントを持っている人なら誰でも参加できる。仲間内だけにしたいときは:

1. Firestore のコンソールで、コレクション **`config`**、ドキュメントID **`access`** を作る
2. フィールド **`emails`**（型: array）に、参加していい Gmail アドレスを並べる

これで、リストにない人は参加できず、テーブルの中身も見られない。

## さらに固くする（任意）

- **APIキーの制限**: Google Cloud コンソール →「APIとサービス」→「認証情報」→ ブラウザ用キーの「アプリケーションの制限」を「ウェブサイト」にして、`https://kurinkufishy.github.io/*` と `https://<プロジェクトID>.firebaseapp.com/*` だけを許可
- **App Check**: reCAPTCHA Enterprise を使って、このサイト以外から関数を呼べないようにできる（設定手順が増えるので今回は未導入）

---

## 仕組み

| やること | どこで | 不正対策 |
|---|---|---|
| ログイン | Firebase Auth（Google） | メール確認済みの Google アカウントだけ通す |
| 着席 `join` | 関数 | 名前は1〜12文字、招待リストを確認 |
| ベット `setBets` | 関数（トランザクション） | 受付時間・残高・金額（0以上の整数）・ゲーム番号をサーバーで確認。置いた分のチップは預かり |
| 配り・精算 `tick` | 関数（トランザクション） | 締切をサーバーの時計で判定。暗号学的乱数でシャッフルした8デッキの山札から配る。1ゲーム1回だけ精算 |
| 入金 `deposit` | 関数 | 1回 1,000,000 まで。入金額は収支から差し引くのでランキングは公平 |
| データの読み書き | Firestore | ブラウザからの書き込みは全部禁止。読めるのは着席済みの人だけ。山札は誰も読めない |

テーブルの進行（締切→配り→結果表示→次のゲーム）は、開いている誰かのブラウザが「そろそろ？」と `tick` を呼び、サーバーが自分の時計で判断して進める。誰も賭けないゲームが3回続くと休憩に入る。

## テスト

```bash
cd functions && npm ci && npm test
```

ルールの判定（`game.js`）と、関数の流れ（ベット→締切→配り→精算→次のゲーム、不正な入力の拒否、招待リスト）をメモリ上のFirestoreで確認する。push すると GitHub Actions でも走る。
