import os
import json
import base64
import requests
import openai
from datetime import datetime

# 環境変数
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPO_OWNER = os.environ.get('GITHUB_REPOSITORY', '').split('/')[0]
GITHUB_REPO_NAME = os.environ.get('GITHUB_REPOSITORY', '').split('/')[-1]
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

# OpenAI API設定
openai.api_key = OPENAI_API_KEY

# GitHubからデータベースを取得
def get_database():
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    try:
        # データベースファイルを取得
        response = requests.get(
            f'https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/contents/data/database.json',
            headers=headers
        )
        
        if response.status_code == 200:
            content = base64.b64decode(response.json()['content']).decode('utf-8')
            database = json.loads(content)
            sha = response.json()['sha']
            return database, sha
        else:
            print(f"Error fetching database: {response.status_code}")
            print(response.text)
            return None, None
    except Exception as e:
        print(f"Exception fetching database: {e}")
        return None, None

# GitHubにデータベースを更新
def update_database(database, sha):
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    try:
        # データベースファイルを更新
        content = json.dumps(database, ensure_ascii=False, indent=2)
        encoded_content = base64.b64encode(content.encode('utf-8')).decode('utf-8')
        
        data = {
            'message': 'Update database with processed ideas',
            'content': encoded_content,
            'sha': sha
        }
        
        response = requests.put(
            f'https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/contents/data/database.json',
            headers=headers,
            json=data
        )
        
        if response.status_code == 200:
            return True
        else:
            print(f"Error updating database: {response.status_code}")
            print(response.text)
            return False
    except Exception as e:
        print(f"Exception updating database: {e}")
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
    database, sha = get_database()
    if not database or not sha:
        print("Failed to fetch database")
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
    if update_database(database, sha):
        print("Database updated successfully")
    else:
        print("Failed to update database")

if __name__ == "__main__":
    main()
