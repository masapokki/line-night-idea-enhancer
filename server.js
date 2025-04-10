const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { exec } = require('child_process');
require('dotenv').config();

// 環境変数
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'YOUR_LINE_CHANNEL_SECRET';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN';
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'YOUR_GITHUB_USERNAME';
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'YOUR_GITHUB_REPO_NAME';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;

// ユーザーの状態を保持するオブジェクト
// key: userId, value: { pendingThinkingProcess: { analysis, evaluation, expansion, feasibility } }
const userStates = {};

// OpenAI APIクライアント
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

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

// 一時ファイル用のディレクトリを静的ファイルとして配信
app.use('/temp', express.static(path.join(__dirname, 'temp')));

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

// アプリケーション起動時にデータディレクトリを作成
function ensureDataDirectory() {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      console.log('Creating data directory...');
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // 一時ファイル用のディレクトリも作成
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      console.log('Creating temp directory...');
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    return true;
  } catch (error) {
    console.error('Error creating directories:', error);
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
    // データディレクトリが存在することを確認
    ensureDataDirectory();
    
    const dbPath = path.join(__dirname, 'data', 'database.json');
    fs.writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving database:', error);
    return false;
  }
}

// GitHubにデータを保存する関数
async function saveToGitHub(userId, content, enhancedResult, mindmapContent) {
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
      processed: true // すでに処理済み
    };
    
    // 結果を保存
    const resultId = `result_${ideaId.slice(5)}`;
    
    database.results[resultId] = {
      idea_id: ideaId,
      analysis: enhancedResult.analysis,
      evaluation: enhancedResult.evaluation,
      expansion: enhancedResult.expansion,
      feasibility: enhancedResult.feasibility,
      enhanced_content: enhancedResult.finalEnhancement,
      mindmap_content: mindmapContent,
      created_at: new Date().toISOString(),
      sent: true // すでに送信済み
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
        message: 'Add new idea and result',
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
          message: 'Create database and add new idea and result',
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

// OpenAI APIを呼び出す関数（タイムアウト付き）
async function callOpenAI(model, messages, temperature = 0.7, maxTokens = null, timeoutMs = 30000) {
  try {
    // タイムアウト処理
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('API request timeout')), timeoutMs);
    });
    
    // API呼び出し
    const apiPromise = openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: temperature,
      ...(maxTokens && { max_tokens: maxTokens })
    });
    
    // タイムアウトとAPI呼び出しを競争
    const response = await Promise.race([apiPromise, timeoutPromise]);
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`OpenAI API error: ${error.message}`);
    if (error.message === 'API request timeout') {
      return '処理がタイムアウトしました。より短いメッセージで再試行してください。';
    }
    return `APIエラーが発生しました: ${error.message}`;
  }
}

// テキストマインドマップをMermaid形式に変換する関数
function convertTextMindmapToMermaid(textMindmap) {
  // コードブロックの区切り文字を削除
  let cleanedText = textMindmap.replace(/```/g, '');
  
  const lines = cleanedText.split('\n');
  let mermaidCode = 'graph TD;\n';
  const nodeMap = new Map();
  let nodeCounter = 0;
  
  // 各行を処理
  lines.forEach(line => {
    // インデントレベルを計算（スペースの数で判断）
    const indentMatch = line.match(/^(\s*)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
    
    // 行の内容を取得（インデントと記号を除去）
    const contentMatch = line.match(/^[\s]*[*\-+]?\s*(.*)/);
    if (!contentMatch || !contentMatch[1].trim()) return;
    
    // 特殊文字をエスケープ
    let content = contentMatch[1].trim();
    content = content
      .replace(/"/g, '\\"')  // ダブルクォートをエスケープ
      .replace(/\[/g, '(')   // 角括弧を丸括弧に置換
      .replace(/\]/g, ')')   // 角括弧を丸括弧に置換
      .replace(/</g, '&lt;') // 不等号をHTMLエンティティに置換
      .replace(/>/g, '&gt;'); // 不等号をHTMLエンティティに置換
    
    const nodeId = `node${nodeCounter++}`;
    
    // ノードを追加
    mermaidCode += `  ${nodeId}["${content}"];\n`;
    
    // 親ノードとの関係を追加
    if (indentLevel > 0) {
      const parentLevel = indentLevel - 1;
      // 親ノードを探す
      for (const [id, data] of [...nodeMap.entries()].reverse()) {
        if (data.level === parentLevel) {
          mermaidCode += `  ${id} --> ${nodeId};\n`;
          break;
        }
      }
    }
    
    // ノード情報を保存
    nodeMap.set(nodeId, { level: indentLevel, content });
  });
  
  console.log('Generated Mermaid code:', mermaidCode);
  return mermaidCode;
}

// Mermaid形式から画像を生成する関数
async function generateMindmapImage(mermaidCode) {
  // 一時ディレクトリの作成（存在しない場合）
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // 一時ファイルパスの生成
  const timestamp = Date.now();
  const tempMmdFile = path.join(tempDir, `mindmap_${timestamp}.mmd`);
  const outputPngFile = path.join(tempDir, `mindmap_${timestamp}.png`);
  
  // Mermaidコードを一時ファイルに書き込む
  fs.writeFileSync(tempMmdFile, mermaidCode);
  
  // mmdc CLIを使用してPNG画像を生成
  return new Promise((resolve, reject) => {
    // Puppeteerに--no-sandboxオプションを追加（Railwayなどのクラウド環境用）
    // 一時的な設定ファイルを作成
    const puppeteerConfigPath = path.join(tempDir, `puppeteer_config_${timestamp}.json`);
    const puppeteerConfig = {
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    
    try {
      fs.writeFileSync(puppeteerConfigPath, JSON.stringify(puppeteerConfig));
      
      // 見やすさを改善するためのオプション
      // -t: テーマ (forest - より見やすいテーマ)
      // -b: 背景色 (white - 透明背景ではなく白背景)
      // -w: 幅 (1200px - 横長の問題を解決)
      // -H: 高さ (800px - 適切な高さ)
      // -s: スケール (2 - 文字を大きく)
      exec(`npx mmdc -i ${tempMmdFile} -o ${outputPngFile} -t forest -b white -w 1200 -H 800 -s 2 -p ${puppeteerConfigPath}`, (error, stdout, stderr) => {
        // 一時ファイルを削除
        try {
          fs.unlinkSync(tempMmdFile);
          fs.unlinkSync(puppeteerConfigPath);
        } catch (err) {
          console.error(`Error deleting temporary files: ${err.message}`);
        }
        
        if (error) {
          console.error(`Error generating mindmap: ${error.message}`);
          reject(error);
          return;
        }
        
        resolve(outputPngFile);
      });
    } catch (err) {
      console.error(`Error creating puppeteer config: ${err.message}`);
      reject(err);
    }
  });
}

// マインドマップ画像をLINEに送信する関数
async function sendMindmapImageToLine(userId, imagePath) {
  try {
    // 画像のURLを生成
    // 注: SERVER_URLがhttpsで始まることを確認（LINEの要件）
    let imageUrl = `${SERVER_URL}/temp/${path.basename(imagePath)}`;
    
    // URLがhttpsで始まっていない場合の処理
    if (!imageUrl.startsWith('https://')) {
      console.log(`Warning: Image URL does not start with https. Current URL: ${imageUrl}`);
      
      // Railwayの場合、自動的に割り当てられるURLを使用
      if (process.env.RAILWAY_STATIC_URL) {
        imageUrl = `https://${process.env.RAILWAY_STATIC_URL}/temp/${path.basename(imagePath)}`;
        console.log(`Using Railway static URL: ${imageUrl}`);
      } else {
        console.log('No HTTPS URL available. Skipping image sending.');
        return false;
      }
    }
    
    console.log(`Sending image with URL: ${imageUrl}`);
    
    // LINEに画像を送信
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [
        {
          type: 'image',
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl
        }
      ]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
    
    console.log('Mindmap image sent successfully');
    return true;
  } catch (error) {
    console.error('Error sending mindmap image:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    return false;
  }
}

// マインドマップを生成する関数
async function generateMindmap(ideaContent) {
  try {
    const mindmap = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたはアイデアからテキスト形式のマインドマップを作成するアシスタントです。中心となるアイデアから派生する概念を階層的に表現してください。簡潔に作成してください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアからテキスト形式のマインドマップを作成してください。階層はインデントで表現し、各項目の前には記号（例：*、-、+など）を付けてください：\n\n${ideaContent}` 
        }
      ],
      0.7,
      800
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    return mindmap;
  } catch (error) {
    console.error('Error generating mindmap:', error);
    return `マインドマップの生成中にエラーが発生しました。エラー: ${error.message}`;
  }
}

// マインドマップを生成して画像として送信する関数
async function generateAndSendMindmapImage(userId, textMindmap) {
  try {
    // テキストマインドマップをMermaid形式に変換
    const mermaidCode = convertTextMindmapToMermaid(textMindmap);
    
    // Mermaid形式から画像を生成
    const imagePath = await generateMindmapImage(mermaidCode);
    
    // 画像をLINEに送信
    await sendMindmapImageToLine(userId, imagePath);
    
    // 一定時間後に一時ファイルを削除
    setTimeout(() => {
      try {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          console.log(`Temporary file ${imagePath} deleted`);
        }
      } catch (err) {
        console.error(`Error deleting temporary file: ${err.message}`);
      }
    }, 3600000); // 1時間後に削除
    
    return true;
  } catch (error) {
    console.error('Error in mindmap image generation and sending:', error);
    return false;
  }
}

// アイデアをブラッシュアップする関数
async function enhanceIdea(ideaContent) {
  try {
    // ステップ1: アイデア分析
    console.log('Step 1: Analyzing idea...');
    const analysis = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたはアイデアを分析するエキスパートです。提案されたアイデアの本質、目的、対象ユーザー、解決する問題を簡潔に分析してください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアを分析してください：\n\n${ideaContent}` 
        }
      ],
      0.7,
      200
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    // ステップ2: 強み・弱み評価
    console.log('Step 2: Evaluating strengths and weaknesses...');
    const evaluation = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたはアイデアの評価を行うエキスパートです。アイデアの強みと改善が必要な点を簡潔に特定してください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアの強みと弱みを評価してください：\n\n${ideaContent}\n\n分析結果：\n${analysis}` 
        }
      ],
      0.7,
      200
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    // ステップ3: 拡張と発展
    console.log('Step 3: Expanding and developing the idea...');
    const expansion = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたは創造的なアイデアを発展させるエキスパートです。アイデアをより具体的で実用的な形に拡張してください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアを拡張・発展させてください：\n\n${ideaContent}\n\n分析結果：\n${analysis}\n\n評価：\n${evaluation}` 
        }
      ],
      0.7,
      200
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    // ステップ4: 実現可能性検討
    console.log('Step 4: Assessing feasibility...');
    const feasibility = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたは実現可能性を評価するエキスパートです。アイデアの技術的・経済的な実現可能性を簡潔に検討してください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアの実現可能性を評価してください：\n\n${ideaContent}\n\n拡張案：\n${expansion}` 
        }
      ],
      0.7,
      200
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    // ステップ5: 最終ブラッシュアップ
    console.log('Step 5: Creating final enhanced version...');
    const finalEnhancement = await callOpenAI(
      "gpt-4o",
      [
        { 
          role: "system", 
          content: "あなたは創造的なアイデアを最終的にブラッシュアップするエキスパートです。これまでの分析と評価を統合して、最終的なブラッシュアップ案を作成してください。ユーザーが理解しやすいように、簡潔にまとめてください。" 
        },
        { 
          role: "user", 
          content: `以下のアイデアの最終ブラッシュアップ案を作成してください：\n\n元のアイデア：\n${ideaContent}\n\n分析：\n${analysis}\n\n評価：\n${evaluation}\n\n拡張案：\n${expansion}\n\n実現可能性：\n${feasibility}` 
        }
      ],
      0.7,
      500
    );
    
    // メモリ解放のためのガベージコレクションを促進
    global.gc && global.gc();
    
    // 思考プロセス全体を含む結果を返す
    return {
      analysis,
      evaluation,
      expansion,
      feasibility,
      finalEnhancement
    };
  } catch (error) {
    console.error('Error enhancing idea:', error);
    return {
      error: `アイデアの処理中にエラーが発生しました。エラー: ${error.message}`,
      analysis: 'エラーが発生しました',
      evaluation: 'エラーが発生しました',
      expansion: 'エラーが発生しました',
      feasibility: 'エラーが発生しました',
      finalEnhancement: `アイデアの処理中にエラーが発生しました。しばらくしてからもう一度お試しください。エラー: ${error.message}`
    };
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
        
        // 「詳細を見る」というメッセージを受け取った場合
        if (messageText === '詳細を見る' && userStates[userId] && userStates[userId].pendingThinkingProcess) {
          console.log('Sending thinking process details...');
          
          const thinkingProcess = userStates[userId].pendingThinkingProcess;
          
          // 思考プロセスを送信
          await replyToUser(replyToken, [
            {
              type: 'text',
              text: `【思考プロセス 1/2】\n\n1️⃣ アイデア分析:\n${thinkingProcess.analysis}\n\n2️⃣ 強み・弱み評価:\n${thinkingProcess.evaluation}`
            }
          ]);
          
          // 2つ目のメッセージは別途送信
          await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [
              {
                type: 'text',
                text: `【思考プロセス 2/2】\n\n3️⃣ 拡張と発展:\n${thinkingProcess.expansion}\n\n4️⃣ 実現可能性:\n${thinkingProcess.feasibility}`
              }
            ]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
          });
          
          console.log('Thinking process details sent successfully');
          return res.status(200).send('OK');
        }
        
        // 通常のアイデア処理
        // 処理中メッセージを送信
        await replyToUser(replyToken, [{
          type: 'text',
          text: 'アイデアを処理中です。少々お待ちください...'
        }]);
        
        try {
          // アイデアをブラッシュアップ（複数ステップの思考プロセス）
          console.log('Enhancing idea with multi-step thinking process...');
          const enhancedResult = await enhanceIdea(messageText);
          
          // マインドマップを生成
          console.log('Generating mindmap...');
          const mindmapContent = await generateMindmap(messageText);
          
          // データを保存
          console.log('Saving to GitHub...');
          await saveToGitHub(userId, messageText, enhancedResult, mindmapContent);
          
          // 結果をLINEで送信
          console.log('Sending results to LINE...');
          
          // メッセージを作成（元のアイデア、最終ブラッシュアップ、マインドマップの順）
          const messages = [
            {
              type: 'text',
              text: `【元のアイデア】\n${messageText}`
            }
          ];
          
          // 最終ブラッシュアップ
          messages.push({
            type: 'text',
            text: `【最終ブラッシュアップ】\n${enhancedResult.finalEnhancement}`
          });
          
          // マインドマップをテキストとして送信
          messages.push({
            type: 'text',
            text: `【マインドマップ】\n${mindmapContent}`
          });
          
          // 詳細を見るボタン付きメッセージを追加
          messages.push({
            type: 'text',
            text: '思考プロセスの詳細を見るにはボタンを押してください。',
            quickReply: {
              items: [
                {
                  type: 'action',
                  action: {
                    type: 'message',
                    label: '詳細を見る',
                    text: '詳細を見る'
                  }
                }
              ]
            }
          });
          
          // ユーザーの状態を保存（思考プロセスを保持）
          userStates[userId] = {
            pendingThinkingProcess: {
              analysis: enhancedResult.analysis,
              evaluation: enhancedResult.evaluation,
              expansion: enhancedResult.expansion,
              feasibility: enhancedResult.feasibility
            }
          };
          
          // メッセージを送信
          await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: messages
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
          });
          
          console.log('Text results sent successfully');
          
          // マインドマップを画像として生成して送信
          try {
            console.log('Generating and sending mindmap image...');
            await generateAndSendMindmapImage(userId, mindmapContent);
          } catch (imageError) {
            console.error('Error generating or sending mindmap image:', imageError);
          }
          
        } catch (error) {
          console.error('Error processing idea:', error);
          
          // エラーメッセージを送信
          await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
              type: 'text',
              text: 'アイデアの処理中にエラーが発生しました。しばらくしてからもう一度お試しください。'
            }]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
          });
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
ensureDataDirectory();

// メモリ使用量の監視と制限
const MAX_MEMORY_MB = 450; // 最大メモリ使用量（MB）
const MEMORY_CHECK_INTERVAL = 30000; // メモリチェック間隔（ミリ秒）

// メモリ使用量の監視
const memoryMonitor = setInterval(() => {
  const memoryUsage = process.memoryUsage();
  const usedMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
  
  console.log('Memory usage:');
  console.log(`  RSS: ${usedMemoryMB} MB`);
  console.log(`  Heap total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
  console.log(`  Heap used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`);
  
  // メモリ使用量が閾値を超えた場合、ガベージコレクションを強制的に実行
  if (usedMemoryMB > MAX_MEMORY_MB) {
    console.log(`Memory usage exceeded ${MAX_MEMORY_MB} MB. Forcing garbage collection...`);
    global.gc && global.gc();
    
    // ユーザー状態の一部をクリア（古いデータを削除）
    const userIds = Object.keys(userStates);
    if (userIds.length > 10) {
      console.log('Clearing old user states...');
      // 最も古い半分のユーザー状態を削除
      userIds.slice(0, Math.floor(userIds.length / 2)).forEach(id => {
        delete userStates[id];
      });
    }
  }
}, MEMORY_CHECK_INTERVAL);

// プロセス終了時にインターバルをクリア
process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  clearInterval(memoryMonitor);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  clearInterval(memoryMonitor);
  process.exit(0);
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log('Use ngrok to expose this server to the internet');
  console.log('Example: ngrok http 3000');
});
