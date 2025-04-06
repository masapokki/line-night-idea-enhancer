const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 環境変数
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'YOUR_LINE_CHANNEL_SECRET';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN';
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'YOUR_GITHUB_USERNAME';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'YOUR_GITHUB_REPO_NAME';

// GitHubクライアント
const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

// Expressアプリケーション
const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// LINEメッセージ送信関数
async function replyToUser(replyToken, messages) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    console.log('Message sent successfully');
    return true;
  } catch (error) {
    console.error('Error replying to user:', error.response ? error.response.data : error.message);
    return false;
  }
}

// データベースファイルを読み込む関数
function readDatabase() {
  try {
    const dbPath = path.join(__dirname, 'data', 'database.json');
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(data);
    }
    return { users: {}, ideas: {}, results: {} };
  } catch (error) {
    console.error('Error reading database:', error);
    return { users: {}, ideas: {}, results: {} };
  }
}

// データベースファイルを保存する関数
function saveDatabase(database) {
  try {
    const dbPath = path.join(__dirname, 'data', 'database.json');
    fs.writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving database:', error);
    return false;
  }
}

// GitHubにデータを保存する関数
async function saveToGitHub(userId, content) {
  try {
    // ローカルデータベースを更新
    const database = readDatabase();
    
    // ユーザー情報を保存/更新
    if (!database.users[userId]) {
      database.users[userId] = {
        created_at: new Date().toISOString()
      };
    }
    
    // アイデア情報を保存
    const ideaId = `idea_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${Object.keys(database.ideas).length + 1}`.padEnd(20, '0').slice(0, 20);
    
    database.ideas[ideaId] = {
      user_id: userId,
      content: content,
      created_at: new Date().toISOString(),
      processed: false
    };
    
    // ローカルに保存
    if (saveDatabase(database)) {
      console.log('Database saved locally');
    }
    
    // GitHubにコミット
    try {
      // 現在のファイルを取得
      const { data } = await octokit.repos.getContent({
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        path: 'data/database.json'
      });
      
      const encodedContent = Buffer.from(JSON.stringify(database, null, 2)).toString('base64');
      
      await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_REPO_OWNER,
        repo: GITHUB_REPO_NAME,
        path: 'data/database.json',
        message: 'Add new idea',
        content: encodedContent,
        sha: data.sha
      });
      
      console.log('Database updated on GitHub');
    } catch (error) {
      if (error.status === 404) {
        // ファイルが存在しない場合は新規作成
        const encodedContent = Buffer.from(JSON.stringify(database, null, 2)).toString('base64');
        
        await octokit.repos.createOrUpdateFileContents({
          owner: GITHUB_REPO_OWNER,
          repo: GITHUB_REPO_NAME,
          path: 'data/database.json',
          message: 'Create database and add new idea',
          content: encodedContent
        });
        
        console.log('Database created on GitHub');
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error saving to GitHub:', error);
    return false;
  }
}

// Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  // シグネチャ検証
  const signature = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');
  
  const lineSignature = req.headers['x-line-signature'];
  
  if (signature !== lineSignature) {
    console.error('Invalid signature');
    return res.status(401).send('Unauthorized');
  }
  
  // LINEイベント処理
  try {
    const body = req.body;
    
    // Webhookの検証イベント
    if (body.events.length === 0) {
      return res.status(200).send('Webhook verified');
    }
    
    for (const lineEvent of body.events) {
      // メッセージイベントのみ処理
      if (lineEvent.type === 'message' && lineEvent.message.type === 'text') {
        const userId = lineEvent.source.userId;
        const messageText = lineEvent.message.text;
        const replyToken = lineEvent.replyToken;
        
        console.log(`Received message from ${userId}: ${messageText}`);
        
        // アイデアとして保存
        const saved = await saveToGitHub(userId, messageText);
        
        if (saved) {
          // ユーザーに応答
          await replyToUser(replyToken, [{
            type: 'text',
            text: 'アイデアを受け付けました。朝に処理結果をお送りします。'
          }]);
        } else {
          // エラー応答
          await replyToUser(replyToken, [{
            type: 'text',
            text: 'アイデアの保存に失敗しました。しばらくしてからもう一度お試しください。'
          }]);
        }
      }
    }
    
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// ヘルスチェックエンドポイント
app.get('/', (req, res) => {
  res.send('LINE Night Idea Enhancer is running!');
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log('Use ngrok to expose this server to the internet');
  console.log('Example: ngrok http 3000');
});
