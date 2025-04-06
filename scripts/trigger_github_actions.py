import os
import json
import requests
from dotenv import load_dotenv

# .envファイルから環境変数を読み込む
load_dotenv()

# 環境変数
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')
GITHUB_REPO_OWNER = os.environ.get('GITHUB_REPO_OWNER')
GITHUB_REPO_NAME = os.environ.get('GITHUB_REPO_NAME')

# GitHub APIのベースURL
API_BASE_URL = f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}"

# ヘッダー
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json'
}

def list_workflows():
    """ワークフローの一覧を取得"""
    url = f"{API_BASE_URL}/actions/workflows"
    print(f"API URL: {url}")
    
    response = requests.get(url, headers=headers)
    
    print(f"ステータスコード: {response.status_code}")
    print(f"レスポンスヘッダー: {json.dumps(dict(response.headers), indent=2)}")
    
    if response.status_code == 200:
        response_json = response.json()
        print(f"レスポンス全体: {json.dumps(response_json, indent=2)}")
        
        workflows = response_json.get('workflows', [])
        if workflows:
            print("利用可能なワークフロー:")
            for workflow in workflows:
                print(f"ID: {workflow['id']}, 名前: {workflow['name']}, 状態: {workflow['state']}")
            return workflows
        else:
            print("ワークフローが見つかりませんでした")
            return []
    else:
        print(f"ワークフロー一覧の取得に失敗しました: {response.status_code}")
        print(f"エラーレスポンス: {response.text}")
        return None

def trigger_workflow(workflow_id, ref="master"):
    """ワークフローを手動で実行"""
    url = f"{API_BASE_URL}/actions/workflows/{workflow_id}/dispatches"
    data = {
        'ref': ref
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 204:
        print(f"ワークフロー {workflow_id} の実行をトリガーしました")
        return True
    else:
        print(f"ワークフローの実行トリガーに失敗しました: {response.status_code}")
        print(response.text)
        return False

def check_workflow_runs(workflow_id):
    """ワークフローの実行状況を確認"""
    url = f"{API_BASE_URL}/actions/workflows/{workflow_id}/runs"
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        runs = response.json()['workflow_runs']
        if runs:
            latest_run = runs[0]
            print(f"最新の実行: ID: {latest_run['id']}, 状態: {latest_run['status']}, 結果: {latest_run['conclusion']}")
            print(f"詳細: {latest_run['html_url']}")
        else:
            print("このワークフローの実行はまだありません")
        return runs
    else:
        print(f"ワークフロー実行の取得に失敗しました: {response.status_code}")
        print(response.text)
        return None

def main():
    """メイン処理"""
    print("GitHub Actionsワークフローのトリガースクリプト")
    print("================================================")
    
    # 環境変数の確認
    if not all([GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME]):
        print("環境変数が設定されていません。.envファイルを確認してください。")
        print(f"GITHUB_TOKEN: {'設定済み' if GITHUB_TOKEN else '未設定'}")
        print(f"GITHUB_REPO_OWNER: {GITHUB_REPO_OWNER or '未設定'}")
        print(f"GITHUB_REPO_NAME: {GITHUB_REPO_NAME or '未設定'}")
        return
    
    print(f"リポジトリ: {GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}")
    print(f"トークン: {GITHUB_TOKEN[:4]}...{GITHUB_TOKEN[-4:]}")
    
    # ワークフロー一覧の取得
    workflows = list_workflows()
    if workflows is None:
        return
    
    if not workflows:
        print("ワークフローが見つからないため、処理を終了します。")
        return
    
    # ユーザー入力
    try:
        workflow_id = int(input("\nトリガーするワークフローのIDを入力してください: "))
        
        # ワークフローの実行
        if trigger_workflow(workflow_id):
            print("\nワークフローの実行状況を確認しています...")
            check_workflow_runs(workflow_id)
    except ValueError:
        print("有効なIDを入力してください")
    except KeyboardInterrupt:
        print("\n処理を中断しました")

if __name__ == "__main__":
    main()
