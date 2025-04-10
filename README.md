# LINE ナイトアイデアエンハンサー

寝る前にLINEにアイデアをメモしておくと、夜の間にAIがそのアイデアをブラッシュアップしたりマインドマップを作成したりして、翌朝その結果を送信してくれるLINEボットアプリケーションです。

## 機能

- LINEからのアイデアメモの受信
- AIによるアイデアのブラッシュアップ
- テキスト形式のマインドマップ生成
- 翌朝の自動結果送信

## 技術スタック

- GitHub Actions（定期実行）
- Express（Webサーバー）
- LINE Messaging API
- OpenAI API
- Python
- Railway（デプロイ）

## セットアップ方法

### 前提条件

- LINE Developersアカウント
- OpenAI APIキー
- GitHubアカウント
- Railwayアカウント

### 開発環境のセットアップ

1. このリポジトリをクローン
   ```
   git clone https://github.com/yourusername/line-night-idea-enhancer.git
   cd line-night-idea-enhancer
   ```

2. 依存関係をインストール
   ```
   npm install
   ```

3. 環境変数を設定
   ```
   cp .env.example .env
   ```
   `.env`ファイルを編集して、必要な環境変数を設定します。

4. ローカルサーバーを起動
   ```
   npm run dev
   ```

5. 開発用にngrokを使用する場合（オプション）
   ```
   npm run tunnel
   ```
   または
   ```
   npm run dev:tunnel
   ```
   ngrokが生成したHTTPS URLをメモしておきます（例: `https://abc123.ngrok.io`）。

### LINE Developersの設定

1. [LINE Developers Console](https://developers.line.biz/console/)にアクセス
2. 新規プロバイダーを作成（既存のものを使用してもOK）
3. 新規チャンネルを作成（Messaging API）
4. チャンネルシークレットとチャンネルアクセストークンを取得
5. Webhook URLを設定（デプロイ後のURL + `/webhook`、例: `https://your-app.railway.app/webhook`）
6. Webhookの利用をオンに設定

### GitHub Actionsの設定

1. GitHubにリポジトリをプッシュ
2. 以下のシークレットをGitHubリポジトリに設定
   - LINE_CHANNEL_SECRET
   - LINE_CHANNEL_ACCESS_TOKEN
   - OPENAI_API_KEY
   - GITHUB_TOKEN（リポジトリへの書き込み権限が必要）

### Railwayへのデプロイ

1. [Railway](https://railway.app/)にアクセスし、アカウントを作成またはログイン
2. 「New Project」をクリック
3. 「Deploy from GitHub repo」を選択
4. リポジトリを選択し、「Deploy Now」をクリック
5. 「Variables」タブで以下の環境変数を設定
   - LINE_CHANNEL_SECRET
   - LINE_CHANNEL_ACCESS_TOKEN
   - GITHUB_TOKEN
   - GITHUB_REPO_OWNER
   - GITHUB_REPO_NAME
   - OPENAI_API_KEY
   - PORT（デフォルトは3000）
6. デプロイが完了したら、生成されたURLをコピー（例: `https://your-app.railway.app`）
7. LINE Developers ConsoleでWebhook URLを更新（URL + `/webhook`）

## 使い方

1. LINEで友達登録
2. 夜にアイデアをメッセージとして送信
3. 「アイデアを受け付けました」という応答が来ることを確認
4. 翌朝、AIによって処理された結果が届く

## 開発時の注意点

- ローカル開発中は、GitHub Actionsのワークフローを手動で実行してテストできます。GitHubリポジトリの「Actions」タブから各ワークフローを選択し、「Run workflow」ボタンをクリックします。
- Railwayの無料プランには制限があります。詳細は[Railwayの料金ページ](https://railway.app/pricing)を確認してください。

## 仕組み

1. ユーザーからのメッセージはLINE Webhook経由でRailwayにデプロイされたサーバーに送信
2. サーバーはメッセージを処理し、アイデアとして認識した場合はGitHubリポジトリのJSONファイルに保存
3. GitHub Actionsが夜間に実行され、未処理のアイデアをAIで処理
4. 処理結果はJSONファイルに保存
5. 朝になると別のGitHub Actionsが実行され、処理結果をLINE Messaging APIを通じてユーザーに送信

## ライセンス

MIT
