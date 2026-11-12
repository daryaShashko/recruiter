#!/usr/bin/env python3
"""Send test vacancies to Telegram Topics (2 to Hot Match and 3 to Review).

Demonstrates:
- Topic 2 (Hot Match): 2 vacancies with Topic 2 buttons and company dossier + link.
- Topic 3 (Review): 3 vacancies with Topic 3 buttons and company dossier + Google search fallback.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "-1004357080568")


SUPERGROUP_CHAT_ID = "-1004357080568"


def send_message(payload, max_retries=3):
    if not BOT_TOKEN:
        sys.exit("Error: TELEGRAM_BOT_TOKEN environment variable is not set")

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    for attempt in range(1, max_retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                res = json.loads(resp.read().decode())
                print(f"✅ Sent message to thread {payload.get('message_thread_id')}: ID {res.get('result', {}).get('message_id')}")
                return res
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode()
            print(f"❌ Telegram Error 400 details: {err_msg}")
            print("Payload:", json.dumps(payload, indent=2))
            raise
        except Exception as e:
            print(f"⚠️ Network error (attempt {attempt}/{max_retries}): {e}")
            if attempt == max_retries:
                raise
            time.sleep(2)




def main():
    print(f"Sending test vacancies to Telegram Chat {CHAT_ID}...")

    # --- TOPIC 2: HOT MATCH (already sent ID 147, 148) ---
    hot_matches = []


    for hm in hot_matches:
        comp_link = f"[🌐 Сайт компании]({hm['company_url']})" if hm['company_url'] else f"[🔍 Найти в Google](https://www.google.com/search?q={urllib.parse.quote(hm['company'] + ' software')})"
        text = f"""🔥 *{hm['title']}* (Score: {hm['score']})
🏢 {hm['company']}
💰 {hm['salary']}
📍 {hm['location']} | {hm['source']}
🔗 {hm['url']}

🏢 *О компании:*
{hm['dossier']}
{comp_link}

_{hm['reason']}_"""

        payload = {
            "chat_id": SUPERGROUP_CHAT_ID,
            "message_thread_id": 2,
            "text": text,
            "parse_mode": "Markdown",
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {"text": "🚀 Подготовить отклик", "callback_data": f"app:{hm['page_id']}"}
                    ],
                    [
                        {"text": "🔗 Вакансия", "url": hm["url"]},
                        {"text": "👎 В архив", "callback_data": f"rej:{hm['page_id']}"}
                    ]
                ]
            }
        }
        send_message(payload)
        time.sleep(1)

    # --- TOPIC 3: REVIEW (VACANCY 3) ---
    reviews = [
        {
            "title": "Senior Software Engineer (Node.js/Next.js)",
            "company": "EdTech Innovate",
            "company_url": None,
            "dossier": "Информация о компании уточняется.",  # Test fallback dossier
            "salary": "не указана",
            "location": "Remote (Poland)",
            "source": "justjoin.it",
            "url": "https://justjoin.it/offers/edtech-senior-engineer",
            "score": 62,
            "reason": "Интересный стек Next.js/Node.js, но зарплатная вилка не раскрыта работодателем.",
            "flags": "Salary: Disclosed None",
            "page_id": "11111111222233334444555566667705"
        }
    ]

    for rv in reviews:
        comp_link = f"[🌐 Сайт компании]({rv['company_url']})" if rv['company_url'] else f"[🔍 Найти в Google](https://www.google.com/search?q={urllib.parse.quote(rv['company'] + ' software')})"
        text = f"""📋 *{rv['title']}* (Score: {rv['score']})
🏢 {rv['company']}
💰 {rv['salary']}
📍 {rv['location']} | {rv['source']}
🔗 {rv['url']}

🏢 *О компании:*
{rv['dossier']}
{comp_link}

📝 *Вердикт:* _{rv['reason']}_

⚠️ *Red Flags:* {rv['flags']}"""

        payload = {
            "chat_id": SUPERGROUP_CHAT_ID,
            "message_thread_id": 3,
            "text": text,
            "parse_mode": "Markdown",
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {"text": "👍 Берём в Hot Match", "callback_data": f"prm:{rv['page_id']}"},
                        {"text": "👎 В архив", "callback_data": f"dsc:{rv['page_id']}"}
                    ],
                    [
                        {"text": "🔗 Вакансия", "url": rv["url"]}
                    ]
                ]
            }
        }
        send_message(payload)
        time.sleep(1)

    print("\n🎉 All 5 test vacancies sent successfully to Telegram!")


if __name__ == "__main__":
    main()
