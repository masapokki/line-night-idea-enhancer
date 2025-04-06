import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv

# .envファイルから環境変数を読み込む
load_dotenv()

# 環境変数
LINE_CHANNEL_ACCESS_TOKEN = os.environ.get('LINE_CHANNEL_ACCESS_TOKEN')

print(f"Using LINE Channel Access Token: {LINE_CHANNEL_ACCESS_TOKEN[:5]}...{LINE_CHANNEL_ACCESS_TOKEN[-5:]}")

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
    
    try:
        response = requests.post(
            'https://api.line.me/v2/bot/message/push',
            headers=headers,
            json=data
        )
        
        if response.status_code == 200:
            return True
        else:
            print(f"Error sending LINE message: {response.status_code}")
            print(response.text)
            return False
    except Exception as e:
        print(f"Exception sending LINE message: {e}")
        return False

# メイン処理
def main():
    print("Starting notification sending...")
    
    # データベースを取得
    database = read_database()
    if not database:
        print("Failed to read database")
        return
    
    # 未送信の結果を検索
    unsent_results = {
        result_id: result_data
        for result_id, result_data in database.get('results', {}).items()
        if not result_data.get('sent', False)
    }
    
    if not unsent_results:
        print("No unsent results found")
        return
    
    print(f"Found {len(unsent_results)} unsent results")
    
    # 各結果を処理
    for result_id, result_data in unsent_results.items():
        print(f"Sending result: {result_id}")
        
        # 関連するアイデアを取得
        idea_id = result_data.get('idea_id', '')
        idea_data = database.get('ideas', {}).get(idea_id, {})
        
        if not idea_data:
            print(f"Idea not found for result: {result_id}")
            continue
        
        # ユーザーIDを取得
        user_id = idea_data.get('user_id', '')
        
        if not user_id:
            print(f"User ID not found for idea: {idea_id}")
            continue
        
        # 元のアイデア内容
        original_idea = idea_data.get('content', '')
        
        # ブラッシュアップされた内容
        enhanced_content = result_data.get('enhanced_content', '')
        
        # マインドマップ
        mindmap_content = result_data.get('mindmap_content', '')
        
        # LINEメッセージを作成
        messages = [
            {
                'type': 'text',
                'text': f"おはようございます！昨晩のアイデアを処理しました。\n\n【元のアイデア】\n{original_idea}"
            },
            {
                'type': 'text',
                'text': f"【ブラッシュアップ】\n{enhanced_content}"
            },
            {
                'type': 'text',
                'text': f"【マインドマップ】\n{mindmap_content}"
            }
        ]
        
        # LINEにメッセージを送信
        if send_line_message(user_id, messages):
            print(f"Successfully sent notification to user: {user_id}")
            
            # 送信済みにマーク
            database['results'][result_id]['sent'] = True
        else:
            print(f"Failed to send notification to user: {user_id}")
    
    # データベースを更新
    if save_database(database):
        print("Database updated successfully")
    else:
        print("Failed to update database")

if __name__ == "__main__":
    main()
