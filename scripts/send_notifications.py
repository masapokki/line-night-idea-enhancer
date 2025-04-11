import os
import json
import base64
import requests
import time
from datetime import datetime

# 環境変数
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPO_OWNER = os.environ.get('GITHUB_REPOSITORY', '').split('/')[0]
GITHUB_REPO_NAME = os.environ.get('GITHUB_REPOSITORY', '').split('/')[-1]
LINE_CHANNEL_ACCESS_TOKEN = os.environ.get('LINE_CHANNEL_ACCESS_TOKEN')
SERVER_URL = os.environ.get('SERVER_URL', 'http://localhost:3000')

# マインドマップ画像を生成して送信するAPIを呼び出す関数
def generate_and_send_mindmap(user_id, mindmap_content, result_id):
    try:
        print(f"Calling API to generate and send mindmap for user: {user_id}")
        
        # APIエンドポイントを呼び出す
        response = requests.post(
            f"{SERVER_URL}/api/generate-mindmap",
            json={
                'userId': user_id,
                'mindmapContent': mindmap_content,
                'resultId': result_id
            },
            timeout=60  # タイムアウトを60秒に設定
        )
        
        if response.status_code == 200:
            print("Mindmap image generated and sent successfully")
            return True
        else:
            print(f"Error generating mindmap image: {response.status_code}")
            print(response.text)
            return False
    except Exception as e:
        print(f"Exception generating mindmap image: {e}")
        return False

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
            'message': 'Update database with sent status',
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
    database, sha = get_database()
    if not database or not sha:
        print("Failed to fetch database")
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
        
        # 最大メッセージ長（LINEの制限は5000文字だが、余裕を持たせる）
        max_length = 4000
        
        # LINEメッセージを作成
        messages = [
            {
                'type': 'text',
                'text': f"おはようございます！昨晩のアイデアを処理しました。\n\n【元のアイデア】\n{original_idea}"
            }
        ]
        
        # ブラッシュアップ（長文の場合は分割）
        if len(enhanced_content) <= max_length:
            # 通常のケース：1つのメッセージで送信
            messages.append({
                'type': 'text',
                'text': f"【最終ブラッシュアップ】\n{enhanced_content}"
            })
        else:
            # 長文の場合：分割して送信
            part1 = enhanced_content[:max_length]
            part2 = enhanced_content[max_length:]
            
            messages.append({
                'type': 'text',
                'text': f"【最終ブラッシュアップ (1/2)】\n{part1}"
            })
            
            messages.append({
                'type': 'text',
                'text': f"【最終ブラッシュアップ (2/2)】\n{part2}"
            })
        
        # 詳細を見るボタン付きメッセージを追加
        messages.append({
            'type': 'template',
            'altText': '思考プロセスの詳細を見る',
            'template': {
                'type': 'buttons',
                'text': '思考プロセスの詳細を見るにはボタンを押してください。',
                'actions': [
                    {
                        'type': 'message',
                        'label': '詳細を見る',
                        'text': '詳細を見る'
                    }
                ]
            }
        })
        
        # LINEにメッセージを送信
        if send_line_message(user_id, messages):
            print(f"Successfully sent text notification to user: {user_id}")
            
            # マインドマップ画像を送信（最終ブラッシュアップ案の後に送信される）
            if mindmap_content:
                # すでに生成されたマインドマップ画像がある場合
                if result_data.get('mindmap_image_path'):
                    print(f"Sending pre-generated mindmap image for user: {user_id}")
                    
                    # 少し待機してからマインドマップ画像を送信（LINEのレート制限対策）
                    time.sleep(1)
                    
                    # 画像のURLを生成
                    image_path = result_data.get('mindmap_image_path')
                    image_url = f"{SERVER_URL}/temp/{image_path}"
                    
                    # LINEに画像を送信
                    try:
                        response = requests.post(
                            'https://api.line.me/v2/bot/message/push',
                            json={
                                'to': user_id,
                                'messages': [
                                    {
                                        'type': 'image',
                                        'originalContentUrl': image_url,
                                        'previewImageUrl': image_url
                                    }
                                ]
                            },
                            headers={
                                'Content-Type': 'application/json',
                                'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}'
                            }
                        )
                        
                        if response.status_code == 200:
                            print(f"Successfully sent pre-generated mindmap image to user: {user_id}")
                            database['results'][result_id]['mindmap_image_generated'] = True
                        else:
                            print(f"Failed to send pre-generated mindmap image to user: {user_id}")
                            print(f"Error: {response.status_code} - {response.text}")
                    except Exception as e:
                        print(f"Exception sending pre-generated mindmap image: {e}")
                
                # マインドマップ画像がない場合は、APIを呼び出して生成・送信
                elif not result_data.get('mindmap_image_generated', False):
                    print(f"Generating and sending mindmap image for user: {user_id}")
                    
                    # 少し待機してからマインドマップ画像を生成して送信（LINEのレート制限対策）
                    time.sleep(1)
                    
                    # マインドマップ画像を生成して送信（最終ブラッシュアップ案とともに送信される）
                    if generate_and_send_mindmap(user_id, mindmap_content, result_id):
                        print(f"Successfully sent mindmap image to user: {user_id}")
                        database['results'][result_id]['mindmap_image_generated'] = True
                    else:
                        print(f"Failed to send mindmap image to user: {user_id}")
            
            # 送信済みにマーク
            database['results'][result_id]['sent'] = True
        else:
            print(f"Failed to send text notification to user: {user_id}")
    
    # データベースを更新
    if update_database(database, sha):
        print("Database updated successfully")
    else:
        print("Failed to update database")

if __name__ == "__main__":
    main()
