const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// テスト用のマインドマップテキスト
const testMindmap = `* マインドマップのテスト
  - 機能1
    + サブ機能1-1
    + サブ機能1-2
  - 機能2
    + サブ機能2-1
    + サブ機能2-2
  - 機能3
    + サブ機能3-1
      * 詳細1
      * 詳細2
    + サブ機能3-2`;

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
async function generateMindmapImage(mermaidCode, outputFormat = 'png') {
  // 一時ディレクトリの作成（存在しない場合）
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // 一時ファイルパスの生成
  const timestamp = Date.now();
  const tempMmdFile = path.join(tempDir, `test_mindmap_${timestamp}.mmd`);
  const outputFile = path.join(tempDir, `test_mindmap_${timestamp}.${outputFormat}`);
  
  // Mermaidコードを一時ファイルに書き込む
  fs.writeFileSync(tempMmdFile, mermaidCode);
  
  // Puppeteerの設定
  const puppeteerConfigPath = path.join(tempDir, `puppeteer_config_${timestamp}.json`);
  const puppeteerConfig = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  
  fs.writeFileSync(puppeteerConfigPath, JSON.stringify(puppeteerConfig));
  
  // mmdc CLIを使用して画像を生成
  return new Promise((resolve, reject) => {
    // 以下のオプションを試してみる
    // -w: 幅 (例: 1200)
    // -H: 高さ (例: 800)
    // -t: テーマ (例: forest, dark, neutral, default)
    // -b: 背景色 (例: transparent, white)
    // -s: スケール (例: 2)
    // -p: Puppeteer設定ファイル
    
    // スマートフォン表示に最適化したサイズ比
    // 縦長の比率（9:16）に近い値を設定
    // 幅を小さく、高さを大きくする
    const command = `npx mmdc -i ${tempMmdFile} -o ${outputFile} -t forest -b white -w 800 -H 1200 -s 2 -p ${puppeteerConfigPath}`;
    
    console.log(`Executing command: ${command}`);
    
    exec(command, (error, stdout, stderr) => {
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
      
      console.log(`Mindmap image generated successfully: ${outputFile}`);
      resolve(outputFile);
    });
  });
}

// テスト実行
async function runTest() {
  try {
    console.log('Converting text mindmap to Mermaid format...');
    const mermaidCode = convertTextMindmapToMermaid(testMindmap);
    
    console.log('Generating PNG image...');
    const pngFile = await generateMindmapImage(mermaidCode, 'png');
    console.log(`PNG file created: ${pngFile}`);
    
    console.log('Generating SVG image...');
    const svgFile = await generateMindmapImage(mermaidCode, 'svg');
    console.log(`SVG file created: ${svgFile}`);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// テスト実行
runTest();
