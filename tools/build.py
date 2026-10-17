#!/usr/bin/env python3
"""Bridge & Bow Travel: static site builder.

One shared source (site/site.json) drives everything that repeats across pages:

  * the header nav (and its active state) on every page
  * the footer on every page
  * the hub card grids on the section index pages
  * the "Start reading" cards and the stat counters on the home page
  * <title>, meta description, canonical, Open Graph and Twitter tags
  * the JSON-LD description, dateModified and image
  * sitemap.xml and feed.xml

Page bodies stay hand-written HTML. Run from anywhere:

    python3 tools/build.py          # rewrite files in place
    python3 tools/build.py --check  # exit 1 if anything is out of date or invalid

The output is plain static HTML, so GitHub Pages serves it as before.
"""
import html
import json
import os
import re
import sys
from email.utils import format_datetime
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, "site", "site.json"), encoding="utf-8"))
BASE = DATA["base_url"]
PAGES = DATA["pages"]
SECTIONS = DATA["sections"]
BY_PATH = {p["path"]: p for p in PAGES}
ERRORS = []

CARET = ('<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" '
         'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')
LOGO = ('<svg width="28" height="28" viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="#0F2340"/>'
        '<path d="M9 27 L28 27 L40 31 L34 37 L12 37 C8.5 37 7 32 9 27 Z" fill="#B9862F"/>'
        '<rect x="14.5" y="17" width="13" height="10" rx="1" fill="#B9862F"/>'
        '<rect x="17" y="20.3" width="2.2" height="2.2" fill="#0F2340"/>'
        '<rect x="20.4" y="20.3" width="2.2" height="2.2" fill="#0F2340"/>'
        '<rect x="23.8" y="20.3" width="2.2" height="2.2" fill="#0F2340"/>'
        '<line x1="21" y1="17" x2="21" y2="9.5" stroke="#B9862F" stroke-width="1.6" stroke-linecap="round"/>'
        '<circle cx="21" cy="8.5" r="1.6" fill="#B9862F"/></svg>')


def esc(t):
    return html.escape(t, quote=True)


def rel(frm, to):
    """Relative href from page `frm` to site path `to`."""
    return os.path.relpath(to, os.path.dirname(frm) or ".").replace(os.sep, "/")


def section_pages(sec_id, kinds=("guide", "photos")):
    return [p for p in PAGES if p["section"] == sec_id and p["kind"] in kinds]


# ---------------------------------------------------------------- nav + footer
def render_nav(page):
    cur = page["path"]
    a = lambda to: rel(cur, to)
    home_cur = ' aria-current="true"' if cur == "index.html" else ""
    out = ['<nav class="primary" id="nav">', f'      <a href="{a("index.html")}"{home_cur}>Home</a>']
    for sec in SECTIONS:
        active = page["section"] == sec["id"] and page.get("active") != "photos"
        cur_attr = ' aria-current="true"' if active else ""
        out.append('      <div class="nav-item has-sub">')
        out.append(f'        <a href="{a(sec["index"])}"{cur_attr}>{esc(sec["label"])}</a>')
        out.append(f'        <button type="button" class="sub-toggle" aria-expanded="false" '
                   f'aria-label="Show {esc(sec["label"])} pages">{CARET}</button>')
        out.append('        <div class="submenu">')
        out.append(f'          <a href="{a(sec["index"])}">{esc(sec["all_label"])}</a>')
        for p in section_pages(sec["id"]):
            out.append(f'          <a href="{a(p["path"])}">{esc(p["nav"])}</a>')
        out.append("        </div>")
        out.append("      </div>")
    photos = next(p for p in PAGES if p.get("active") == "photos")
    ph_cur = ' aria-current="true"' if page.get("active") == "photos" else ""
    out.append(f'      <a href="{a(photos["path"])}"{ph_cur}>Photos</a>')
    out.append("    </nav>")
    return "\n".join(out)


def render_footer(page):
    a = lambda to: rel(page["path"], to)
    cols = []
    for sec in SECTIONS:
        items = "".join(f'<li><a href="{a(p["path"])}">{esc(p["footer"])}</a></li>' for p in section_pages(sec["id"]))
        cols.append(f'      <div><h3>{esc(sec["label"])}</h3><ul>{items}</ul></div>')
    about = ("".join(f'<li><a href="{a(p)}">{l}</a></li>' for p, l in
                     [("about.html", "Our Story"), ("contact.html", "Contact"), ("privacy.html", "Privacy &amp; Cookies")]))
    return f'''<footer>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="brand" style="margin-bottom:10px;">
          {LOGO}
          <div class="brand-word" style="font-size:17px;">Bridge &amp; Bow</div>
        </div>
        <p style="font-size:13px; color:var(--ink-soft); max-width:30ch;">Family cruise planning, charted one sailing at a time.</p>
      </div>
{chr(10).join(cols)}
      <div><h3>About</h3><ul>{about}</ul></div>
    </div>
    <div class="disclosure">
      <span><b>Affiliate disclosure:</b> Bridge &amp; Bow Travel earns a commission on bookings made through some links on this site, at no extra cost to you.</span>
      <span><a href="{a("privacy.html")}">Privacy &amp; Cookie Policy</a> · <a href="#" data-cookie-settings>Cookie settings</a></span>
    </div>
    <div class="copyright">© 2026 Bridge &amp; Bow Travel. All rights reserved.</div>
  </div>
</footer>'''


def render_banner(page):
    return f'''<div class="cookie-banner" id="cookieBanner" role="dialog" aria-label="Cookie choices">
  <svg class="icon" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="none" stroke="#B9862F" stroke-width="2"/><circle cx="18" cy="18" r="2" fill="#B9862F"/><circle cx="28" cy="16" r="2" fill="#B9862F"/><circle cx="30" cy="26" r="2" fill="#B9862F"/><circle cx="22" cy="30" r="2" fill="#B9862F"/></svg>
  <p>We only use analytics cookies if you accept them. Partner sites you click through to may set their own cookies. See our <a style="text-decoration:underline;" href="{rel(page["path"], "privacy.html")}">Privacy &amp; Cookie Policy</a>.</p>
  <div class="actions">
    <button class="cookie-btn" type="button" data-cookie-choice="essential">Essential only</button>
    <button class="cookie-btn accept" type="button" data-cookie-choice="all">Accept all</button>
  </div>
</div>'''


# ---------------------------------------------------------------- hubs + home
def render_hub_cards(sec_id, hub_path):
    cards = []
    for p in section_pages(sec_id):
        h = p["hub"]
        cards.append(f'''        <a class="hub-card" href="{rel(hub_path, p["path"])}">
          <span class="hub-kicker">{esc(h["kicker"])}</span>
          <h2>{esc(h["title"])}</h2>
          <p>{esc(h["blurb"])}</p>
          <span class="hub-go">{esc(h["cta"])}</span>
        </a>''')
    return "\n".join(cards)


def render_home_cards():
    items = sorted((p for p in PAGES if "home" in p), key=lambda p: p["home"]["order"])
    out = []
    for p in items:
        h = p["home"]
        out.append(f'''      <a class="guide-card" href="{p["path"]}">
        <div class="guide-tag">{esc(h["tag"])}</div>
        <h3>{esc(h["title"])}</h3>
        <p>{esc(h["blurb"])}</p>
      </a>''')
    return "\n".join(out)


def render_stats():
    guides = len([p for p in PAGES if p["kind"] == "guide"])
    lines = len(DATA["cruise_lines"])
    ports = len([p for p in PAGES if p["section"] == "ports" and p["kind"] == "guide"])
    cells = [(guides, "In-depth guides published"), (lines, "Cruise lines reviewed"),
             (ports, "Ports covered, more added each sailing"), (1, "Very opinionated toddler co-pilot")]
    return "\n".join(f'      <div class="stat-cell"><div class="stat-num3d" data-count="{n}">0</div>'
                     f'<div class="stat-label3d">{esc(l)}</div></div>' for n, l in cells)


def marker_sub(text, name, new, fallback_re=None, label=None):
    """Replace the content between <!-- build:name --> markers, adding markers on first run."""
    start, end = f"<!-- build:{name} -->", f"<!-- /build:{name} -->"
    if start in text:
        return re.sub(re.escape(start) + r".*?" + re.escape(end), lambda m: f"{start}\n{new}\n{end}", text, flags=re.S)
    if fallback_re is None:
        ERRORS.append(f"{label}: missing build marker {name}")
        return text
    m = re.search(fallback_re, text, re.S)
    if not m:
        ERRORS.append(f"{label}: cannot find {name} region")
        return text
    tail = "\n" if m.group(1).endswith("\n") else ""
    return text[:m.start(1)] + f"{start}\n{new}\n{end}" + tail + text[m.end(1):]


# ---------------------------------------------------------------- head sync
def canonical(page):
    return f"{BASE}/{page['url'] if 'url' in page else page['path']}"


def og_url(img):
    return f"{BASE}/{img}"


def sync_head(text, page, label):
    title, desc = page["title"], page["desc"]
    img = og_url(page.get("og_image") or DATA["default_og_image"])
    kind = "website" if page["kind"] in ("home", "hub", "meta") else "article"
    text = re.sub(r"<title>.*?</title>", lambda m: f"<title>{esc(title)}</title>", text, count=1, flags=re.S)
    text = re.sub(r'\n?<meta name="description" content="[^"]*">', "", text)
    text = re.sub(r'\n?<meta (?:property="og:[a-z:_]+"|name="twitter:[a-z:_]+") content="[^"]*">', "", text)
    text = re.sub(r'\n?<link rel="canonical" href="[^"]*">', "", text)
    block = (f'<meta name="description" content="{esc(desc)}">\n'
             f'<link rel="canonical" href="{canonical(page)}">\n'
             f'<meta property="og:type" content="{kind}">\n'
             f'<meta property="og:site_name" content="{esc(DATA["name"])}">\n'
             f'<meta property="og:title" content="{esc(title)}">\n'
             f'<meta property="og:description" content="{esc(desc)}">\n'
             f'<meta property="og:url" content="{canonical(page)}">\n'
             f'<meta property="og:image" content="{img}">\n'
             f'<meta name="twitter:card" content="summary_large_image">\n'
             f'<meta name="twitter:title" content="{esc(title)}">\n'
             f'<meta name="twitter:description" content="{esc(desc)}">\n'
             f'<meta name="twitter:image" content="{img}">')
    text, n = re.subn(r"(</title>)", lambda m: m.group(1) + "\n" + block, text, count=1)
    if n != 1:
        ERRORS.append(f"{label}: no <title> to anchor head block")
    return text


def sync_jsonld(text, page, label):
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', text, re.S)
    if not m:
        return text
    body = m.group(2)
    img = og_url(page.get("og_image") or DATA["default_og_image"])
    desc_json = json.dumps(page["desc"], ensure_ascii=False)
    body = re.sub(r'"description": "(?:[^"\\]|\\.)*"', lambda _: f'"description": {desc_json}', body)
    if page.get("date"):
        body = re.sub(r'"dateModified": "[^"]*"', f'"dateModified": "{page["date"]}"', body)
    if page["kind"] in ("guide", "photos"):
        if '"image":' in body:
            body = re.sub(r'"image": "[^"]*"', f'"image": "{img}"', body)
        else:
            body = body.replace('"@type": "Article",', f'"@type": "Article",\n      "image": "{img}",', 1)
    try:
        json.loads(body)
    except ValueError as e:
        ERRORS.append(f"{label}: JSON-LD invalid after sync: {e}")
        return text
    return text[:m.start(2)] + body + text[m.end(2):]


# ---------------------------------------------------------------- per-page build
def build_page(page):
    path = page["path"]
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        ERRORS.append(f"{path}: listed in site.json but file is missing")
        return None
    text = open(full, encoding="utf-8").read()
    text = sync_head(text, page, path)
    text = sync_jsonld(text, page, path)
    text, n = re.subn(r'<nav class="primary" id="nav">.*?</nav>', lambda m: render_nav(page), text, count=1, flags=re.S)
    if n != 1:
        ERRORS.append(f"{path}: nav not found")
    text, n = re.subn(r"<footer>.*?</footer>", lambda m: render_footer(page), text, count=1, flags=re.S)
    if n != 1:
        ERRORS.append(f"{path}: footer not found")
    text, n = re.subn(r'<div class="cookie-banner" id="cookieBanner".*?</div>\n</div>', lambda m: render_banner(page), text, count=1, flags=re.S)
    if n != 1:
        # Some pages were missing the banner entirely: add it just before the main.js script.
        text, n = re.subn(r'(<script src="[^"]*assets/js/main\.js)', lambda m: render_banner(page) + "\n\n" + m.group(1), text, count=1)
        if n != 1:
            ERRORS.append(f"{path}: cookie banner not found and no main.js anchor to add it")
    if "googletagmanager.com" in text:
        ERRORS.append(f"{path}: loads Google Analytics directly; it must only load through assets/js/analytics.js")
    if page["kind"] == "hub":
        text = marker_sub(text, "hub", render_hub_cards(page["section"], path),
                          r'<div class="hub-grid">\n?(.*?)\n?\s*</div>\n\s*<p class="hub-more">', path)
    if page["kind"] == "home":
        text = marker_sub(text, "stats", render_stats(),
                          r'<div class="stat-grid3d">\n?((?:[ ]*<div class="stat-cell">[^\n]*\n)+)', path)
        text = marker_sub(text, "home-cards", render_home_cards(),
                          r'<div class="guide-grid">\n?(.*?)\n?[ ]*</div>\n[ ]*</div>\n</section>', path)
    return text


def build_404():
    nf = DATA["not_found"]
    path = nf["path"]
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    page = {"path": path, "url": path, "kind": "meta", "title": nf["title"], "desc": nf["desc"],
            "og_image": DATA["default_og_image"]}
    text = sync_head(text, page, path)
    text = text.replace('<link rel="canonical" href="%s">\n' % canonical(page), "")
    if '<meta name="robots"' not in text:
        text = text.replace("</title>", '</title>\n<meta name="robots" content="noindex">', 1)
    return text


def build_sitemap():
    rows = []
    for p in PAGES:
        rows.append(f"  <url>\n    <loc>{canonical(p)}</loc>\n    <lastmod>{p['date']}</lastmod>\n"
                    f"    <changefreq>{p['freq']}</changefreq>\n    <priority>{p['priority']}</priority>\n  </url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(rows) + "\n</urlset>\n")


def build_feed():
    items = sorted((p for p in PAGES if p.get("feed")), key=lambda p: (p["published"], p["path"]), reverse=True)
    out = []
    for p in items:
        d = datetime.fromisoformat(p["published"]).replace(hour=12, tzinfo=timezone.utc)
        out.append(f"  <item>\n    <title>{html.escape(p['feed'], quote=False)}</title>\n    <link>{canonical(p)}</link>\n"
                   f"    <guid>{canonical(p)}</guid>\n    <description>{html.escape(p['desc'], quote=False)}</description>\n"
                   f"    <pubDate>{format_datetime(d, usegmt=True)}</pubDate>\n  </item>\n")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n'
            f'  <title>{html.escape(DATA["name"], quote=False)}</title>\n  <link>{BASE}/</link>\n'
            "  <description>Family cruise planning — honest ship reviews, port guides, and packing lists.</description>\n"
            "  <language>en-us</language>\n"
            f'  <atom:link href="{BASE}/feed.xml" rel="self" type="application/rss+xml"/>\n\n' + "\n".join(out) + "\n</channel>\n</rss>\n")


# ---------------------------------------------------------------- validation
def validate():
    seen_titles, seen_paths = set(), set()
    for p in PAGES:
        for k in ("path", "title", "desc", "date", "freq", "priority"):
            if not p.get(k):
                ERRORS.append(f"{p.get('path')}: missing {k}")
        if p["path"] in seen_paths:
            ERRORS.append(f"{p['path']}: duplicate path")
        seen_paths.add(p["path"])
        if len(p["title"]) > 60:
            ERRORS.append(f"{p['path']}: title is {len(p['title'])} chars (max 60)")
        if not 120 <= len(p["desc"]) <= 155:
            ERRORS.append(f"{p['path']}: description is {len(p['desc'])} chars (want 120-155)")
        if p["title"] in seen_titles:
            ERRORS.append(f"{p['path']}: duplicate title")
        seen_titles.add(p["title"])
        img = p.get("og_image") or DATA["default_og_image"]
        if not os.path.exists(os.path.join(ROOT, img)):
            ERRORS.append(f"{p['path']}: og_image {img} missing")
        if p["kind"] in ("guide", "photos"):
            for k in ("nav", "footer", "hub", "published", "feed"):
                if k not in p:
                    ERRORS.append(f"{p['path']}: guide is missing '{k}'")
    on_disk = set()
    for dp, dn, fn in os.walk(ROOT):
        if any(x in dp for x in (".git", "node_modules", "tools", "site")):
            continue
        for f in fn:
            if f.endswith(".html"):
                on_disk.add(os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, "/"))
    missing = on_disk - seen_paths - {DATA["not_found"]["path"]}
    for m in sorted(missing):
        ERRORS.append(f"{m}: HTML file not listed in site/site.json")


def main():
    check = "--check" in sys.argv
    validate()
    outputs = {}
    for p in PAGES:
        t = build_page(p)
        if t is not None:
            outputs[p["path"]] = t
    outputs[DATA["not_found"]["path"]] = build_404()
    outputs["sitemap.xml"] = build_sitemap()
    outputs["feed.xml"] = build_feed()
    stale = []
    for path, new in outputs.items():
        full = os.path.join(ROOT, path)
        old = open(full, encoding="utf-8").read() if os.path.exists(full) else None
        if old != new:
            stale.append(path)
            if not check and not ERRORS:
                open(full, "w", encoding="utf-8").write(new)
    for e in ERRORS:
        print("ERROR:", e)
    if check:
        for s in stale:
            print("OUT OF DATE:", s)
        sys.exit(1 if (ERRORS or stale) else 0)
    if ERRORS:
        print("Nothing written. Fix the errors above.")
        sys.exit(1)
    print(f"Built {len(outputs)} files, {len(stale)} changed.")


if __name__ == "__main__":
    main()
