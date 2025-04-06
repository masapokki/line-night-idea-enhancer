import os
import json
import openai
from datetime import datetime
import sys
from dotenv import load_dotenv

# .envファイルから環境変数を読み込む
load_dotenv()

# 環境変数
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

# OpenAI API設定
openai.api_key = OPENAI_API_KEY

print(f"Using OpenAI API Key: {OPENAI_API_KEY[:5]}...{OPENAI_API_KEY[-5:]}")

# ローカルデータベースを読み込む
def read_database():
    try:
        with open('data/database.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading database: {e}")
        return None

# ローカルデータベースを保存
def save_database(database):
    try:
        with open('data/database.json', 'w', encoding='utf-8') as f:
            json.dump(database, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error saving database: {e}")
        return False

# アイデアをブラッシュアップ
def enhance_idea(idea_content):
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "あなたは創造的なアイデアを発展させるアシスタントです。ユーザーのアイデアを分析し、それを発展させ、より具体的で実用的なものにしてください。"},
                {"role": "user", "content": f"以下のアイデアをブラッシュアップしてください：\n\n{idea_content}"}
            ],
            max_tokens=1000,
            temperature=0.7
        )
        return response.choices[0].message['content'].strip()
    except Exception as e:
        print(f"Error enhancing idea: {e}")
        return f"アイデアの処理中にエラーが発生しました。エラー: {str(e)}"

# マインドマップを生成
def generate_mindmap(idea_content):
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "あなたはアイデアからテキスト形式のマインドマップを作成するアシスタントです。中心となるアイデアから派生する概念を階層的に表現してください。"},
                {"role": "user", "content": f"以下のアイデアからテキスト形式のマインドマップを作成してください。階層はインデントで表現し、各項目の前には記号（例：*、-、+など）を付けてください：\n\n{idea_content}"}
            ],
            max_tokens=1500,
            temperature=0.7
        )
        return response.choices[0].message['content'].strip()
    except Exception as e:
        print(f"Error generating mindmap: {e}")
        return f"マインドマップの生成中にエラーが発生しました。エラー: {str(e)}"

# メイン処理
def main():
    print("Starting idea processing...")
    
    # データベースを取得
    database = read_database()
    if not database:
        print("Failed to read database")
        return
    
    # 未処理のアイデアを検索
    unprocessed_ideas = {
        idea_id: idea_data
        for idea_id, idea_data in database.get('ideas', {}).items()
        if not idea_data.get('processed', False)
    }
    
    if not unprocessed_ideas:
        print("No unprocessed ideas found")
        return
    
    print(f"Found {len(unprocessed_ideas)} unprocessed ideas")
    
    # 各アイデアを処理
    for idea_id, idea_data in unprocessed_ideas.items():
        print(f"Processing idea: {idea_id}")
        
        # アイデアの内容
        idea_content = idea_data.get('content', '')
        
        # アイデアをブラッシュアップ
        enhanced_content = enhance_idea(idea_content)
        
        # マインドマップを生成
        mindmap_content = generate_mindmap(idea_content)
        
        # 結果を保存
        result_id = f"result_{idea_id[5:]}"  # idea_20250406_001 -> result_20250406_001
        
        database.setdefault('results', {})[result_id] = {
            'idea_id': idea_id,
            'enhanced_content': enhanced_content,
            'mindmap_content': mindmap_content,
            'created_at': datetime.now().isoformat(),
            'sent': False
        }
        
        # アイデアを処理済みにマーク
        database['ideas'][idea_id]['processed'] = True
    
    # データベースを更新
    if save_database(database):
        print("Database updated successfully")
    else:
        print("Failed to update database")

if __name__ == "__main__":
    main()
