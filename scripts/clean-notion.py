import os
import json
import urllib.request

# Load env
env_path = os.path.join(os.path.dirname(__file__), "../.env")
notion_token = None
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if line.startswith("NOTION_TOKEN="):
                notion_token = line.strip().split("=", 1)[1]

eval_db_id = "36c747f7-ebec-80c8-bfd7-ed317f4a7c35"

# 1. Fetch all pages from Evaluation Log and archive them
if notion_token:
    print(f"Connecting to Notion to clean Evaluation Log DB ({eval_db_id})...")
    has_more = True
    next_cursor = None
    deleted_count = 0
    
    while has_more:
        body = {"page_size": 100}
        if next_cursor:
            body["start_cursor"] = next_cursor
            
        req = urllib.request.Request(
            f"https://api.notion.com/v1/databases/{eval_db_id}/query",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {notion_token}",
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                results = data.get("results", [])
                for page in results:
                    page_id = page["id"]
                    # Archive page
                    patch_req = urllib.request.Request(
                        f"https://api.notion.com/v1/pages/{page_id}",
                        data=json.dumps({"archived": True}).encode("utf-8"),
                        headers={
                            "Authorization": f"Bearer {notion_token}",
                            "Notion-Version": "2022-06-28",
                            "Content-Type": "application/json"
                        },
                        method="PATCH"
                    )
                    with urllib.request.urlopen(patch_req) as p_resp:
                        deleted_count += 1
                        if deleted_count % 20 == 0:
                            print(f"Archived {deleted_count} pages so far...")
                
                has_more = data.get("has_more", False)
                next_cursor = data.get("next_cursor")
        except Exception as e:
            print("Error querying Notion:", e)
            break
            
    print(f"Finished cleaning Evaluation Log! Total archived: {deleted_count} pages.")
else:
    print("No NOTION_TOKEN found in .env")
