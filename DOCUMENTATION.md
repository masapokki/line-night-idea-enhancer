# LINE ナイトアイデアエンハンサー 技術ドキュメント

このドキュメントは、LINE ナイトアイデアエンハンサーの技術的な詳細、アーキテクチャ、実装方法、トラブルシューティングなどをまとめたものです。

## 1. プロジェクト概要

LINE ナイトアイデアエンハンサーは、ユーザーが寝る前にLINEにアイデアをメモしておくと、夜の間にAIがそのアイデアをブラッシュアップしたりマインドマップを作成したりして、翌朝その結果を送信してくれるLINEボットアプリケーションです。

### 主な機能

- LINEからのアイデアメモの受信
- AIによるアイデアのブラッシュアップ
- テキスト形式のマインドマップ生成
- 翌朝の自動結果送信

### 技術スタック

- **バックエンド**: Node.js (Express)
- **AI処理**: Python + OpenAI API
- **データ保存**: JSON (GitHubリポジトリ)
- **スケジューリング**: GitHub Actions
- **メッセージング**: LINE Messaging API
- **ローカル開発**: ngrok

## 2. アーキテクチャと設計

### 全体アーキテクチャ

```
+----------------+     +----------------+     +----------------+
|                |     |                |     |                |
|  LINEユーザー   +---->+  Expressサーバー +---->+  JSONデータベース |
|                |     |  (ngrok経由)    |     |  (GitHub)     |
+----------------+     +----------------+     +-------+--------+
                                                      |
                                                      v
+----------------+     +----------------+     +----------------+
|                |     |                |     |                |
|  LINEユーザー   <----+  LINE API       <----+  GitHub Actions  |
|                |     |                |     |  (Python処理)   |
+----------------+     +----------------+     +----------------+
```

### データフロー

1. ユーザーがLINEにアイデアを送信
2. LINE WebhookがExpressサーバーにリクエストを送信
3. Expressサーバーがアイデアをデータベース（JSON）に保存
4. GitHub Actionsが夜間に実行され、未処理のアイデアをAIで処理
5. 処理結果がデータベースに保存
6. GitHub Actionsが朝に実行され、処理結果をLINE APIを通じてユーザーに送信

### データモデル

```json
{
  "users": {
    "USER_ID": {
      "created_at": "TIMESTAMP"
    }
  },
  "ideas": {
    "idea_YYYYMMDD_NNNNNN": {
      "user_id": "USER_ID",
      "content": "アイデア内容",
      "created_at": "TIMESTAMP",
      "processed": true/false
    }
  },
  "results": {
    "result_YYYYMMDD_NNNNNN": {
      "idea_id": "idea_YYYYMMDD_NNNNNN",
      "enhanced_content": "ブラッシュアップ内容",
      "mindmap_content": "マインドマップ内容",
      "created_at": "TIMESTAMP",
      "sent": true/false
    }
  }
}
```

## 3. コンポーネント詳細

### 3.1 Expressサーバー (server.js)

Expressサーバーは、LINEからのWebhookリクエストを処理し、アイデアをデータベースに保存します。

**主な機能**:
- LINE Webhookの検証
- メッセージの受信と処理
- データベースへの保存
- ユーザーへの応答

**重要なコード**:

```javascript
// Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  // シグネチャ検証
  const signature = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');
  
  const lineSignature = req.headers['x-line-signature'];
  
  if (signature !== lineSignature) {
    return res.status(401).send('Unauthorized');
  }
  
  // メッセージ処理
  // ...
});
```

### 3.2 アイデア処理スクリプト (scripts/process_ideas.py)

このPythonスクリプトは、GitHub Actionsによって夜間に実行され、未処理のアイデアをAIで処理します。

**主な機能**:
- データベースからの未処理アイデアの取得
- OpenAI APIを使用したアイデアのブラッシュアップ
- テキスト形式のマインドマップ生成
- 処理結果のデータベースへの保存

**重要なコード**:

```python
# アイデアをブラッシュアップ
def enhance_idea(idea_content):
    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "あなたは創造的なアイデアを発展させるアシスタントです。..."},
            {"role": "user", "content": f"以下のアイデアをブラッシュアップしてください：\n\n{idea_content}"}
        ],
        max_tokens=1000,
        temperature=0.7
    )
    return response.choices[0].message['content'].strip()
```

### 3.3 通知送信スクリプト (scripts/send_notifications.py)

このPythonスクリプトは、GitHub Actionsによって朝に実行され、処理結果をLINEで送信します。

**主な機能**:
- データベースからの未送信結果の取得
- LINE Messaging APIを使用したメッセージ送信
- 送信済みステータスの更新

**重要なコード**:

```python
# LINEにメッセージを送信
def send_line_message(user_id, messages):
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}'
    }
    
    data = {
        'to': user_id,
        'messages': messages
    }
    
    response = requests.post(
        'https://api.line.me/v2/bot/message/push',
        headers=headers,
        json=data
    )
```

### 3.4 GitHub Actions ワークフロー

GitHub Actionsは、定期的にPythonスクリプトを実行するために使用されます。

**夜間処理ワークフロー** (.github/workflows/night_processing.yml):
- 毎晩23時（UTC 14:00）に実行
- process_ideas.pyスクリプトを実行
- 結果をGitHubリポジトリにコミット

**朝の通知ワークフロー** (.github/workflows/morning_notification.yml):
- 毎朝7時（UTC 22:00）に実行
- send_notifications.pyスクリプトを実行
- 送信済みステータスをGitHubリポジトリにコミット

## 4. 開発・テスト手順

### 4.1 ローカル開発環境のセットアップ

1. リポジトリのクローン:
   ```
   git clone https://github.com/yourusername/line-night-idea-enhancer.git
   cd line-night-idea-enhancer
   ```

2. 依存関係のインストール:
   ```
   npm install
   pip install openai==0.28 requests python-dotenv
   ```

3. 環境変数の設定:
   ```
   cp .env.example .env
   ```
   `.env`ファイルを編集して、必要な環境変数を設定します。

4. サーバーの起動:
   ```
   npm run dev
   ```

5. ngrokの起動:
   ```
   npm run tunnel
   ```
   または、両方を同時に実行:
   ```
   npm run dev:tunnel
   ```

### 4.2 LINE Developersの設定

1. [LINE Developers Console](https://developers.line.biz/console/)にアクセス
2. 新規プロバイダーを作成（既存のものを使用してもOK）
3. 新規チャンネルを作成（Messaging API）
4. チャンネルシークレットとチャンネルアクセストークンを取得
5. Webhook URLを設定（ngrokが生成したURL + `/webhook`）
6. Webhookの利用をオンに設定

### 4.3 テスト手順

1. **Webhook受信テスト**:
   - LINEアプリでボットにメッセージを送信
   - サーバーのログで受信を確認
   - データベースファイルでアイデアの保存を確認

2. **アイデア処理テスト**:
   ```
   python scripts/process_ideas_local.py
   ```
   - データベースファイルで処理結果を確認

3. **通知送信テスト**:
   ```
   python scripts/send_notifications_local.py
   ```
   - LINEアプリで通知を確認
   - データベースファイルで送信済みステータスを確認

## 5. トラブルシューティング

### 5.1 よくある問題と解決策

#### LINE Webhookの検証エラー

**症状**: LINE Developersコンソールでの「検証」ボタンクリック時に「接続に失敗しました」というエラーが表示される。

**解決策**:
- ngrokが正常に動作しているか確認
- Webhook URLが正しく設定されているか確認（末尾に`/webhook`が必要）
- サーバーが起動しているか確認

#### OpenAI APIのエラー

**症状**: アイデア処理時に「No API key provided」などのエラーが表示される。

**解決策**:
- `.env`ファイルにOPENAI_API_KEYが正しく設定されているか確認
- OpenAI APIキーが有効か確認
- OpenAI Python SDKのバージョンを確認（0.28を使用）

#### GitHub APIのエラー

**症状**: GitHub APIへのリクエスト時に401や404などのエラーが表示される。

**解決策**:
- GITHUB_TOKENが正しく設定されているか確認
- トークンに必要な権限（repo）が付与されているか確認
- リポジトリ名とユーザー名が正しく設定されているか確認

### 5.2 デバッグ方法

1. **サーバーログの確認**:
   - `npm run dev`でサーバーを起動し、ログを確認

2. **ngrokログの確認**:
   - ngrokダッシュボード（http://localhost:4040）でリクエスト/レスポンスを確認

3. **データベースの確認**:
   - `data/database.json`ファイルの内容を確認

4. **GitHub Actionsログの確認**:
   - GitHubリポジトリの「Actions」タブでワークフローの実行ログを確認

## 6. 参考リソース

### 6.1 API ドキュメント

- [LINE Messaging API](https://developers.line.biz/ja/reference/messaging-api/)
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [GitHub API](https://docs.github.com/ja/rest)

### 6.2 ライブラリドキュメント

- [Express](https://expressjs.com/ja/)
- [OpenAI Python SDK](https://github.com/openai/openai-python)
- [Octokit](https://github.com/octokit/rest.js)
- [ngrok](https://ngrok.com/docs)

### 6.3 その他の参考資料

- [GitHub Actions ドキュメント](https://docs.github.com/ja/actions)
- [LINE Bot SDK](https://github.com/line/line-bot-sdk-nodejs)
- [dotenv](https://github.com/motdotla/dotenv)

## 7. 注意事項

### 7.1 セキュリティ

- APIキーやトークンは`.env`ファイルに保存し、Gitリポジトリにコミットしないでください。
- LINE Webhook URLは公開されるため、適切な認証と検証を行ってください。
- ユーザーデータの取り扱いには十分注意してください。

### 7.2 コスト

- OpenAI APIは使用量に応じた課金が発生します。コストを抑えるために、処理するアイデアの量を調整してください。
- GitHub Actionsは、パブリックリポジトリでは無料で利用できますが、プライベートリポジトリでは制限があります。
- ngrokの無料プランでは、セッションが8時間で切れます。本番環境では、固定URLを持つサービスの使用を検討してください。

### 7.3 メンテナンス

- OpenAI APIのバージョンが変更された場合、スクリプトの修正が必要になる可能性があります。
- LINE Messaging APIの仕様変更に注意してください。
- GitHub Actionsの実行時間に制限があるため、処理が長時間かかる場合は注意が必要です。
