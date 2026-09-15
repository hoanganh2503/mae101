"""Doc comment/binh luan trong moi thread MAE101, tim cac cau tra loi dang
"<so cau><dap an>" (vd "12c", "12. C", "Cau 12: C"...), gop phieu bau va
dien vao data/answers.json cho nhung cau CHUA co dap an (khong ghi de dap an
da co san, vi answers.json la du lieu admin da xac nhan).

Luu y: comment tu nguoi dung rat da dang, format khac nhau, nen day la suy
doan tot nhat (best-effort) - khong dam bao dung 100%. Nen mo admin.html
kiem tra lai truoc khi tin tuong hoan toan, dac biet nhung cau chi co 1 vote.

Vi du:
    python crawler/extract_answers.py                  # tat ca de da tai (co thu muc anh)
    python crawler/extract_answers.py --pages 1         # chi de o trang 1 danh sach forum
    python crawler/extract_answers.py --only "SU 2023"
    python crawler/extract_answers.py --limit 3 --dry-run
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

from crawl import (
    BASE,
    REPO_ROOT,
    USER_AGENT,
    classify_section,
    get_thread_list,
    sanitize,
)

ANSWERS_FILE = REPO_ROOT / "data" / "answers.json"

# "<1-3 chu so><A-F>" dung lien nhau hoac cach nhau boi khoang trang / . ) : -
# Loai tru neu truoc do la 1 chu so khac (tranh cat vun so nam/id dai), va
# loai tru neu sau chu cai la 1 chu cai khac (tranh dinh vao tu nhu "FE"/"chon").
ANSWER_RE = re.compile(r"(?<!\d)(\d{1,3})\s*[.):\-]?\s*([A-Fa-f])(?![A-Za-z])")


def extract_texts(page):
    return page.eval_on_selector_all(
        "article.message--post .message-body .bbWrapper",
        """els => els.map(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('blockquote').forEach(b => b.remove());
            return clone.innerText;
        })""",
    )


def get_reply_page_count(page):
    nums = [int(t) for t in page.eval_on_selector_all("a.pageNav-page", "els => els.map(e => e.textContent.trim())") if t.isdigit()]
    return max(nums) if nums else 1


def collect_votes(page, thread_url: str, max_q: int):
    votes = {}
    page_count = None
    p = 1
    while True:
        url = thread_url if p == 1 else thread_url.rstrip("/") + f"/page-{p}"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if page_count is None:
            page_count = get_reply_page_count(page)
        for text in extract_texts(page):
            for m in ANSWER_RE.finditer(text):
                q = int(m.group(1))
                if q < 1 or q > max_q:
                    continue
                letter = m.group(2).upper()
                votes.setdefault(q, Counter())[letter] += 1
        if p >= page_count:
            break
        p += 1
    return votes


def pick_best(votes):
    return {q: counter.most_common(1)[0][0] for q, counter in votes.items()}


def find_exam_dir(out_root: Path, section: str, safe_name: str):
    d = out_root / section / safe_name
    return d if d.exists() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=3, help="So trang danh sach de duyet qua (mac dinh 3)")
    ap.add_argument("--out", type=str, default=str(REPO_ROOT))
    ap.add_argument("--only", type=str, default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="Chi in ket qua, khong ghi answers.json")
    args = ap.parse_args()

    out_root = Path(args.out)
    answers = json.loads(ANSWERS_FILE.read_text(encoding="utf-8")) if ANSWERS_FILE.exists() else {}

    total_filled = 0
    skipped_no_folder = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=USER_AGENT)
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
            safe_name = sanitize(title)
            exam_dir = find_exam_dir(out_root, section, safe_name)
            print(f"[{i}/{len(threads)}] {section}/{safe_name}")

            if exam_dir is None:
                print("  (chua tai anh de nay - bo qua)")
                skipped_no_folder.append(title)
                continue

            jpgs = sorted(exam_dir.glob("*.jpg"))
            if not jpgs:
                print("  (thu muc rong - bo qua)")
                continue
            n = len(jpgs)
            width = len(jpgs[0].stem)
            exam_id = f"{section}/{safe_name}"

            votes = collect_votes(page, thread_url, n)
            best = pick_best(votes)

            existing = answers.get(exam_id, {})
            new_count = 0
            for q, letter in best.items():
                fname = f"{q:0{width}d}.jpg"
                if fname in existing:
                    continue
                existing[fname] = letter
                new_count += 1
            if new_count:
                answers[exam_id] = existing
                total_filled += new_count

            low_conf = [q for q, c in votes.items() if sum(c.values()) == 1]
            print(
                f"  tim thay dap an cho {len(best)}/{n} cau tu comment"
                f" (dien moi {new_count} cau, {len(low_conf)} cau chi co 1 vote)"
            )

        browser.close()

    if not args.dry_run:
        ANSWERS_FILE.write_text(json.dumps(answers, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nDa ghi {ANSWERS_FILE}")
    else:
        print("\n(dry-run, chua ghi file)")

    print(f"Tong cau moi dien: {total_filled}")
    if skipped_no_folder:
        print(f"De chua co thu muc anh ({len(skipped_no_folder)}), bo qua:")
        for t in skipped_no_folder:
            print(" -", t)


if __name__ == "__main__":
    main()
