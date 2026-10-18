#!/usr/bin/env python3
"""
Build and validate tools/pinterest/PinterestQueue.csv from pins_data.py.

Run from the repo root:   python3 tools/pinterest/build_queue.py
Exit code is non-zero if any check fails, so it is safe to run in CI.

Import the CSV into the PinterestQueue tab of the Google Sheet
(File > Import > Upload > "Replace current sheet"). Header names must stay as is.
"""
import csv, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pins_data import SITE, BOARDS, PAGES, VARIANTS, all_variants  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "PinterestQueue.csv")
COLUMNS = ["URL", "PinTitle", "PinDescription", "ImageURL", "BoardID", "Type", "Status",
           "LastPosted", "UTM Campaign", "AltText", "UTMContent", "PinID", "LastError"]

# Things that must never appear in pin copy (identifiers and receipt details).
FORBIDDEN = [r"\$\d", r"\b8560\b", r"\bIAH\b", r"ecopark", r"\bFLL\b", r"lat\.\s*26", r"@"]


def build_rows():
    rows = []
    for page, n, v in all_variants():
        rows.append({
            "URL": SITE + page["path"],
            "PinTitle": v["pin_title"],
            "PinDescription": v["desc"],
            "ImageURL": "%s/assets/img/pins/%s.jpg" % (SITE, v["slug"]),
            "BoardID": BOARDS[page["board"]],
            "Type": v.get("type", "evergreen"),
            "Status": "pending",
            "LastPosted": "",
            "UTM Campaign": page["campaign"],
            "AltText": v["alt"],
            "UTMContent": v["content"],
            "PinID": "",
            "LastError": "",
        })
    return rows


def validate(rows):
    errors = []
    try:
        from PIL import Image
    except ImportError:
        Image = None
        errors.append("Pillow not installed; cannot check image sizes")

    for name in BOARDS.values():
        if len(name) > 50:
            errors.append("board name over 50 chars: %r (%d)" % (name, len(name)))
    seen_images, seen_titles = set(), set()
    per_url = {}
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        tag = "row %d (%s)" % (i, r["UTMContent"])
        if len(r["PinTitle"]) > 100:
            errors.append("%s: title is %d chars (max 100)" % (tag, len(r["PinTitle"])))
        if len(r["PinDescription"]) > 800:
            errors.append("%s: description is %d chars (max 800)" % (tag, len(r["PinDescription"])))
        if len(r["AltText"]) > 500:
            errors.append("%s: alt text over 500 chars" % tag)
        if r["PinTitle"] in seen_titles:
            errors.append("%s: duplicate pin title" % tag)
        seen_titles.add(r["PinTitle"])
        path = r["URL"][len(SITE):]
        if not os.path.isfile(os.path.join(ROOT, path.lstrip("/"))):
            errors.append("%s: page file missing for %s" % (tag, path))
        img = os.path.join(ROOT, r["ImageURL"][len(SITE):].lstrip("/"))
        if not os.path.isfile(img):
            errors.append("%s: image missing %s" % (tag, img))
        elif Image is not None and Image.open(img).size != (1000, 1500):
            errors.append("%s: image is not 1000x1500" % tag)
        if r["ImageURL"] in seen_images:
            errors.append("%s: image reused by another row" % tag)
        seen_images.add(r["ImageURL"])
        for field in ("PinTitle", "PinDescription", "AltText"):
            for pat in FORBIDDEN:
                if re.search(pat, r[field], re.I):
                    errors.append("%s: forbidden pattern %r in %s" % (tag, pat, field))
        if r["Type"] not in ("new", "evergreen"):
            errors.append("%s: bad Type %r" % (tag, r["Type"]))
        per_url[r["URL"]] = per_url.get(r["URL"], 0) + 1
    for url, count in per_url.items():
        if count < 3:
            errors.append("%s has only %d variant(s); want 3" % (url, count))
    live_pages = {SITE + p["path"] for p in PAGES}
    if set(per_url) != live_pages:
        errors.append("queue pages do not match PAGES list")
    return errors


def main():
    rows = build_rows()
    errors = validate(rows)
    if errors:
        print("VALIDATION FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, quoting=csv.QUOTE_ALL)
        w.writeheader()
        w.writerows(rows)
    new = sum(1 for r in rows if r["Type"] == "new")
    print("wrote %s: %d rows (%d new, %d evergreen) across %d pages"
          % (os.path.relpath(OUT, ROOT), len(rows), new, len(rows) - new, len({r["URL"] for r in rows})))


if __name__ == "__main__":
    main()
