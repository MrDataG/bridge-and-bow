# Bridge & Bow Travel

Family cruise planning site — ship reviews, port guides, and planning content.
Static HTML/CSS/JS, hosted on GitHub Pages at **bridgeandbowtravel.com**.

## Folder structure

```
bridge-and-bow/
├── index.html                          # Home page
├── privacy.html                        # Privacy & Cookie Policy
├── CNAME                               # Custom domain for GitHub Pages — do not delete
├── robots.txt
├── sitemap.xml                         # Add a new <url> block whenever a page is added
├── cruise-lines/
│   └── disney-fantasy-vs-wish.html     # One file per ship comparison/review
├── ports/
│   └── castaway-cay.html               # One file per port guide
└── assets/
    ├── css/style.css                   # Shared stylesheet — all pages link to this
    ├── js/main.js                      # Shared behavior (scroll reveal, cookie banner, menu)
    └── img/favicon.svg                 # Brand mark
```

## Adding a new page (the scalable part)

1. Copy an existing page in `cruise-lines/` or `ports/` as a starting template.
2. Update the `<title>`, `<meta name="description">`, breadcrumb, and content.
3. Keep the shared `<link rel="stylesheet" href="../assets/css/style.css">` and
   `<script src="../assets/js/main.js">` references — don't duplicate CSS/JS per page.
4. Add a link to the new page from `index.html` (card grid and/or footer) and from
   any related pages' sidebar.
5. Add a `<url>` entry for the new page in `sitemap.xml`.

Planning guides and gear/packing content don't have their own folder yet — create
`planning/` or `gear/` the same way once there's more than one or two articles in
that category.

## Local preview

No build step — open `index.html` directly in a browser, or run a simple local
server from the repo root so relative paths behave the same as production:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deployment

Pushing to the default branch updates the live site automatically via GitHub Pages.
DNS is configured at the registrar (Namecheap) with A records pointing to GitHub's
Pages IPs and a CNAME for `www` — see repo Settings → Pages for domain/HTTPS status.
