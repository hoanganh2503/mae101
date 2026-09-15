"""Mo trinh duyet that de dang nhap fuoverflow.com, luu phien dang nhap ra auth_state.json.

Chay 1 lan (hoac lai khi phien het han):
    python crawler/login.py

Mot cua so Chrome se hien ra. Dang nhap binh thuong. Script tu phat hien
khi dang nhap thanh cong va tu luu phien + dong cua so.
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://fuoverflow.com"
STATE_FILE = Path(__file__).parent / "auth_state.json"
TIMEOUT_SECONDS = 300


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(f"{BASE}/login/", wait_until="domcontentloaded")
        print(f"Hay dang nhap trong cua so trinh duyet vua mo (toi da {TIMEOUT_SECONDS}s)...", flush=True)

        deadline = time.time() + TIMEOUT_SECONDS
        logged_in = False
        while time.time() < deadline:
            try:
                status = page.evaluate("document.documentElement.getAttribute('data-logged-in')")
            except Exception:
                status = None
            if status == "true":
                logged_in = True
                break
            time.sleep(2)

        if not logged_in:
            print("Het thoi gian cho dang nhap. Chay lai script.", flush=True)
            browser.close()
            sys.exit(1)

        context.storage_state(path=str(STATE_FILE))
        print(f"Dang nhap thanh cong. Da luu phien vao {STATE_FILE}", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
