"""Crawl de thi MAE101 tren fuoverflow.com/forums/MAE101/, tai anh ve theo dung
cau truc FE/PT/RE/<ten de>/01.jpg... de dung truc tiep voi build-manifest.js
o thu muc goc repo.

Yeu cau: da chay `python crawler/login.py` truoc do (can dang nhap de tai anh
do phan giai day du - khach khong dang nhap chi thay anh thu nho 336x150).

Vi du:
    python crawler/crawl.py                # crawl het 3 trang, ~60 de
    python crawler/crawl.py --pages 1       # chi trang 1 (test nhanh)
    python crawler/crawl.py --only "SU 2023"
    python crawler/crawl.py --limit 3       # chi 3 de dau (test nhanh)
"""
import argparse
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

BASE = "https://fuoverflow.com"
FORUM_URL = f"{BASE}/forums/MAE101/"
CRAWLER_DIR = Path(__file__).parent
REPO_ROOT = CRAWLER_DIR.parent
STATE_FILE = CRAWLER_DIR / "auth_state.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')
MARKER_NAME = ".full_ok"


class SessionExpired(Exception):
    pass


def sanitize(name: str) -> str:
    name = INVALID_CHARS.sub("-", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name.rstrip(". ")


def classify_section(title: str) -> str:
    t = title.upper()
    if re.search(r"(?<![A-Z])RE(?![A-Z])", t):
        return "RE"
    if re.search(r"FE(?![A-Z])", t):
        return "FE"
    if re.search(r"(?<![A-Z])PT(?![A-Z])", t) or "TEST" in t or "QUIZ" in t:
        return "PT"
    return "Unsorted"


def get_thread_list(page, pages: int):
    threads = []
    seen = set()
    for p in range(1, pages + 1):
        url = FORUM_URL if p == 1 else urljoin(FORUM_URL, f"page-{p}")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        anchors = page.query_selector_all("div.structItem-title a[href*='/threads/']")
        for a in anchors:
            href = a.get_attribute("href")
            if not href or href in seen:
                continue
            title = a.inner_text().strip()
            if not title:
                continue
            seen.add(href)
            threads.append((title, urljoin(BASE, href)))
    return threads


def get_attachment_urls(page, thread_url: str):
    page.goto(thread_url, wait_until="domcontentloaded", timeout=30000)
    logged_in = page.evaluate("document.documentElement.getAttribute('data-logged-in')")
    if logged_in != "true":
        raise SessionExpired()
    first_post = page.query_selector("article.message--post")
    scope = first_post if first_post else page
    attach_block = scope.query_selector(".message-attachments")
    if not attach_block:
        return []
    anchors = attach_block.query_selector_all("li.file.file--linked a.file-preview")
    urls = []
    for a in anchors:
        href = a.get_attribute("href")
        img = a.query_selector("img")
        fallback = img.get_attribute("src") if img else None
        full_url = urljoin(BASE, href) if href else None
        urls.append((full_url, fallback))
    return urls


def download_image(request_ctx, full_url, fallback_url, referer):
    if full_url:
        try:
            resp = request_ctx.get(full_url, headers={"referer": referer}, timeout=30000)
            ctype = resp.headers.get("content-type", "")
            if resp.ok and ctype.startswith("image/"):
                return resp.body(), None
        except Exception:
            pass
    if fallback_url:
        try:
            resp = request_ctx.get(fallback_url, headers={"referer": referer}, timeout=30000)
            ctype = resp.headers.get("content-type", "")
            if resp.ok and ctype.startswith("image/"):
                return resp.body(), "fallback-low-res"
        except Exception:
            pass
    return None, "failed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=3, help="So trang danh sach de crawl (mac dinh 3)")
    ap.add_argument("--out", type=str, default=str(REPO_ROOT), help="Thu muc goc de luu FE/PT/RE")
    ap.add_argument("--only", type=str, default=None, help="Chi crawl de co ten chua chuoi nay")
    ap.add_argument("--limit", type=int, default=None, help="Gioi han so de (de test)")
    ap.add_argument("--delay", type=float, default=0.4, help="Delay (s) giua cac request anh")
    ap.add_argument("--headless", action="store_true", default=True)
    ap.add_argument("--no-headless", dest="headless", action="store_false")
    args = ap.parse_args()

    if not STATE_FILE.exists():
        print(f"Chua co phien dang nhap ({STATE_FILE}). Chay 'python crawler/login.py' truoc.")
        sys.exit(1)

    out_root = Path(args.out)
    unsorted = []
    failures = []
    empty_threads = []
    total_images = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        context = browser.new_context(storage_state=str(STATE_FILE), user_agent=USER_AGENT)
        page = context.new_page()

        print("Dang lay danh sach de...")
        threads = get_thread_list(page, args.pages)
        print(f"Tim thay {len(threads)} de.")

        if args.only:
            threads = [t for t in threads if args.only.lower() in t[0].lower()]
        if args.limit:
            threads = threads[: args.limit]

        for i, (title, thread_url) in enumerate(threads, start=1):
            section = classify_section(title)
            if section == "Unsorted":
                unsorted.append(title)
            safe_name = sanitize(title)
            exam_dir = out_root / section / safe_name
            print(f"[{i}/{len(threads)}] {section}/{safe_name}")

            marker = exam_dir / MARKER_NAME
            existing = sorted(exam_dir.glob("*.jpg")) if exam_dir.exists() else []
            if marker.exists() and existing:
                print(f"  da co du {len(existing)} anh (full-res), bo qua (khong mo trang, tranh rate-limit).")
                continue

            try:
                attachments = get_attachment_urls(page, thread_url)
            except SessionExpired:
                print("\nMAT PHIEN DANG NHAP giua chung! Dung crawl tai day.")
                print("Chay lai 'python crawler/login.py' de dang nhap lai, roi chay lai crawl.py")
                print("(cac de da tai du anh full-res se tu dong duoc bo qua, khong tai lai).")
                break
            time.sleep(args.delay)
            if not attachments:
                print("  (khong co anh dinh kem - bo qua)")
                empty_threads.append(title)
                continue

            if existing:
                for f in existing:
                    f.unlink()

            exam_dir.mkdir(parents=True, exist_ok=True)
            width = max(2, len(str(len(attachments))))
            ok_count = 0
            all_full = True
            for idx, (full_url, fallback_url) in enumerate(attachments, start=1):
                dest = exam_dir / f"{idx:0{width}d}.jpg"
                body, note = download_image(context.request, full_url, fallback_url, thread_url)
                if body is None:
                    print(f"  cau {idx}: TAI LOI")
                    failures.append(f"{safe_name} #{idx}")
                    all_full = False
                    continue
                dest.write_bytes(body)
                if note:
                    print(f"  cau {idx}: {note}")
                    all_full = False
                ok_count += 1
                total_images += 1
                time.sleep(args.delay)
            print(f"  da tai {ok_count}/{len(attachments)} anh.")
            if all_full and ok_count == len(attachments):
                marker.write_text("ok")
            else:
                print("  (chua du chat luong/so luong full-res, se thu lai o lan chay sau)")

        browser.close()

    print("\n=== Xong ===")
    print(f"Tong anh moi tai: {total_images}")
    if empty_threads:
        print(f"De khong co anh ({len(empty_threads)}):")
        for t in empty_threads:
            print(" -", t)
    if unsorted:
        print(f"De chua xac dinh duoc FE/PT/RE ({len(unsorted)}), da luu vao thu muc 'Unsorted', kiem tra lai:")
        for t in unsorted:
            print(" -", t)
    if failures:
        print(f"Anh tai loi ({len(failures)}):")
        for f in failures:
            print(" -", f)


if __name__ == "__main__":
    main()
