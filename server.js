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
async function saveToGitHub(userId, content, enhancedResult, mindmapContent, imagePath = null) {
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
      sent: false, // 未送信（翌朝7時に送信）
      mindmap_image_generated: imagePath ? true : false, // マインドマップ画像生成フラグ
      mindmap_image_path: imagePath ? path.basename(imagePath) : null // マインドマップ画像のパス
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
  let mermaidCode = 'mindmap\n';
  
  // 階層構造を保持する配列
  const hierarchy = [];
  let rootNode = null;
  
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
    
    // インデントレベルに応じてノードを追加
    if (indentLevel === 0) {
      // ルートノード
      rootNode = content;
      mermaidCode += `  root((${content}))\n`;
      hierarchy[0] = 'root';
    } else {
      // 親ノードを特定
      const parentLevel = indentLevel - 1;
      const parentId = hierarchy[parentLevel];
      
      if (parentId) {
        // 現在のノードのID
        const currentId = `id${hierarchy.length}`;
        hierarchy[indentLevel] = currentId;
        
        // 階層に応じてインデントを調整
        const indent = '  '.repeat(indentLevel + 1);
        mermaidCode += `${indent}${parentId}[${content}]\n`;
      }
    }
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
  const outputSvgFile = path.join(tempDir, `mindmap_${timestamp}.svg`);
  
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
      // -C: カスタムCSS (日本語フォントを指定)
      
      // 一時的なCSSファイルを作成（日本語フォント対応）
      const cssContent = `
        /* 日本語フォント対応 */
        .node rect, .node circle, .node ellipse, .node polygon, .node path {
          fill: #fff;
          stroke: #1f2020;
          stroke-width: 1px;
        }
        .node .label {
          font-family: 'Noto Sans JP', 'Meiryo', 'Yu Gothic', 'Hiragino Sans', sans-serif;
        }
        .node text {
          font-family: 'Noto Sans JP', 'Meiryo', 'Yu Gothic', 'Hiragino Sans', sans-serif;
          font-size: 14px;
        }
        .edgeLabel {
          font-family: 'Noto Sans JP', 'Meiryo', 'Yu Gothic', 'Hiragino Sans', sans-serif;
        }
      `;
      const cssFilePath = path.join(tempDir, `custom_style_${timestamp}.css`);
      fs.writeFileSync(cssFilePath, cssContent);
      
      // スマートフォン表示に最適化したサイズ比
      // 縦長の比率（9:16）に近い値を設定
      // 幅を小さく、高さを大きくする
      exec(`npx mmdc -i ${tempMmdFile} -o ${outputSvgFile} -t forest -b white -w 800 -H 1200 -s 2 -p ${puppeteerConfigPath} -C ${cssFilePath}`, (error, stdout, stderr) => {
        // 一時ファイルを削除
        try {
          fs.unlinkSync(tempMmdFile);
          fs.unlinkSync(puppeteerConfigPath);
          fs.unlinkSync(cssFilePath);
        } catch (err) {
          console.error(`Error deleting temporary files: ${err.message}`);
        }
        
        if (error) {
          console.error(`Error generating mindmap: ${error.message}`);
          reject(error);
          return;
        }
        
        resolve(outputSvgFile);
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
async function generateMindmap(ideaContent, enhancedResult = null) {
  try {
    // enhancedResultが提供されている場合は、それを使用してマインドマップを生成
    const messages = [];
    
    // システムプロンプト
    messages.push({ 
      role: "system", 
      content: `あなたはアイデアからテキスト形式のマインドマップを作成するアシスタントです。
以下のルールに従って作成してください：
1. 中心となるアイデアから派生する最も重要な概念のみを抽出する
2. 階層は最大3階層までとする（中心アイデア→主要カテゴリ→詳細項目）
3. 各階層の項目数は3〜5個程度に抑える
4. 各項目は5単語以内の簡潔な表現にする
5. 全体として15項目以内に収める

目標は「一目で理解できる簡潔なマインドマップ」です。` 
    });
    
    // ユーザープロンプト（enhancedResultがある場合は、それを含める）
    if (enhancedResult) {
      messages.push({ 
        role: "user", 
        content: `以下のアイデアと分析結果から簡潔なテキスト形式のマインドマップを作成してください。
階層はインデントで表現し、各項目の前には記号（例：*、-、+など）を付けてください。

【元のアイデア】
${ideaContent}

【分析】
${enhancedResult.analysis}

【評価】
${enhancedResult.evaluation}

【拡張案】
${enhancedResult.expansion}

【実現可能性】
${enhancedResult.feasibility}

【最終ブラッシュアップ】
${enhancedResult.finalEnhancement}`
      });
    } else {
      // enhancedResultがない場合は、元のアイデアのみを使用
      messages.push({ 
        role: "user", 
        content: `以下のアイデアから簡潔なテキスト形式のマインドマップを作成してください。階層はインデントで表現し、各項目の前には記号（例：*、-、+など）を付けてください：\n\n${ideaContent}` 
      });
    }
    
    const mindmap = await callOpenAI(
      "gpt-4o",
      messages,
      0.7
      // maxTokensパラメータを削除
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
      0.7
      // maxTokensパラメータを削除
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
      0.7
      // maxTokensパラメータを削除
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
      0.7
      // maxTokensパラメータを削除
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
      0.7
      // maxTokensパラメータを削除
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
      0.7
      // maxTokensパラメータを削除
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
          const maxLength = 4000; // LINEの制限は5000文字だが、余裕を持たせる
          
          // 思考プロセスのパート1（分析と評価）
          const part1Text = `1️⃣ アイデア分析:\n${thinkingProcess.analysis}\n\n2️⃣ 強み・弱み評価:\n${thinkingProcess.evaluation}`;
          
          if (part1Text.length <= maxLength) {
            // 通常のケース：1つのメッセージで送信
            await replyToUser(replyToken, [
              {
                type: 'text',
                text: `【思考プロセス 1/2】\n\n${part1Text}`
              }
            ]);
          } else {
            // 長文の場合：分割して送信
            const analysisText = `1️⃣ アイデア分析:\n${thinkingProcess.analysis}`;
            const evaluationText = `2️⃣ 強み・弱み評価:\n${thinkingProcess.evaluation}`;
            
            await replyToUser(replyToken, [
              {
                type: 'text',
                text: `【思考プロセス 1/3】\n\n${analysisText}`
              }
            ]);
            
            // 評価は別途送信
            await axios.post('https://api.line.me/v2/bot/message/push', {
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `【思考プロセス 2/3】\n\n${evaluationText}`
                }
              ]
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
              }
            });
          }
          
          // 思考プロセスのパート2（拡張と実現可能性）
          const part2Text = `3️⃣ 拡張と発展:\n${thinkingProcess.expansion}\n\n4️⃣ 実現可能性:\n${thinkingProcess.feasibility}`;
          
          if (part2Text.length <= maxLength) {
            // 通常のケース：1つのメッセージで送信
            await axios.post('https://api.line.me/v2/bot/message/push', {
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `【思考プロセス ${part1Text.length > maxLength ? '3/3' : '2/2'}】\n\n${part2Text}`
                }
              ]
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
              }
            });
          } else {
            // 長文の場合：分割して送信
            const expansionText = `3️⃣ 拡張と発展:\n${thinkingProcess.expansion}`;
            const feasibilityText = `4️⃣ 実現可能性:\n${thinkingProcess.feasibility}`;
            
            await axios.post('https://api.line.me/v2/bot/message/push', {
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `【思考プロセス ${part1Text.length > maxLength ? '3/4' : '2/3'}】\n\n${expansionText}`
                }
              ]
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
              }
            });
            
            // 実現可能性は別途送信
            await axios.post('https://api.line.me/v2/bot/message/push', {
              to: userId,
              messages: [
                {
                  type: 'text',
                  text: `【思考プロセス ${part1Text.length > maxLength ? '4/4' : '3/3'}】\n\n${feasibilityText}`
                }
              ]
            }, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
              }
            });
          }
          
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
          
          // マインドマップを生成（ブラッシュアップ結果を使用）
          console.log('Generating mindmap with enhanced results...');
          const mindmapContent = await generateMindmap(messageText, enhancedResult);
          
          // マインドマップ画像を生成（送信はしない）
          console.log('Generating mindmap image...');
          try {
            // テキストマインドマップをMermaid形式に変換
            const mermaidCode = convertTextMindmapToMermaid(mindmapContent);
            
            // Mermaid形式から画像を生成
            const imagePath = await generateMindmapImage(mermaidCode);
            
            // 画像のURLを生成
            const imageUrl = `${SERVER_URL}/temp/${path.basename(imagePath)}`;
            
            // データを保存（マインドマップ画像のパスも保存）
            console.log('Saving to GitHub...');
            await saveToGitHub(userId, messageText, enhancedResult, mindmapContent, imagePath);
            
            // 一定時間後に一時ファイルを削除しない（翌朝の送信時に使用するため）
          } catch (imageError) {
            console.error('Error generating mindmap image:', imageError);
            
            // エラーが発生しても処理を続行（画像なしでデータを保存）
            console.log('Saving to GitHub without mindmap image...');
            await saveToGitHub(userId, messageText, enhancedResult, mindmapContent);
          }
          
          // 処理完了メッセージを送信
          console.log('Sending completion message to LINE...');
          
          // 完了メッセージを送信
          await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [
              {
                type: 'text',
                text: 'アイデアの処理が完了しました。結果は翌朝7時に送信されます。おやすみなさい。'
              }
            ]
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
          });
          
          console.log('Completion message sent successfully');
          
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

// マインドマップ画像生成・送信APIエンドポイント
app.post('/api/generate-mindmap', async (req, res) => {
  try {
    // リクエストボディの検証
    const { userId, mindmapContent, resultId } = req.body;
    
    if (!userId || !mindmapContent || !resultId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // マインドマップを画像として生成して送信
    console.log(`Generating and sending mindmap image for user: ${userId}`);
    
    try {
      // テキストマインドマップをMermaid形式に変換
      const mermaidCode = convertTextMindmapToMermaid(mindmapContent);
      
      // Mermaid形式から画像を生成
      const imagePath = await generateMindmapImage(mermaidCode);
      
      // 画像をLINEに送信
      const success = await sendMindmapImageToLine(userId, imagePath);
      
      if (success) {
        // データベースを更新（マインドマップ画像生成フラグをtrueに設定）
        const database = readDatabase();
        if (database.results[resultId]) {
          database.results[resultId].mindmap_image_generated = true;
          saveDatabase(database);
          
          // GitHubにも更新を反映
          try {
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
              message: 'Update mindmap image generated status',
              content: encodedContent,
              sha: data.sha
            });
          } catch (error) {
            console.error('Error updating GitHub:', error);
          }
        }
        
        return res.status(200).json({ success: true, message: 'Mindmap image generated and sent successfully' });
      } else {
        return res.status(500).json({ error: 'Failed to send mindmap image' });
      }
    } catch (error) {
      console.error('Error in mindmap image generation and sending:', error);
      return res.status(500).json({ error: `Error generating or sending mindmap image: ${error.message}` });
    }
  } catch (error) {
    console.error('Error in generate-mindmap endpoint:', error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
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
