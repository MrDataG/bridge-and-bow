# Pinterest pipeline

Drives traffic from Pinterest to bridgeandbowtravel.com (and from there to the Viator links).
Pins are posted by a Google Apps Script from a Google Sheet queue; a weekly report shows which
pins and pages earn clicks. **No secrets are stored in this repo.**

## What is in this folder

| File | What it does |
|---|---|
| `pins_data.py` | Single source of truth: pages, boards, and 3 pin variants per page (titles, descriptions, alt text) |
| `make_pins.py` | Generates the 1000x1500 pin images into `assets/img/pins/` |
| `build_queue.py` | Builds and validates `PinterestQueue.csv` (title/description limits, images exist, no identifiers) |
| `PinterestQueue.csv` | 36 queue rows (12 pages x 3 variants), ready to import into the sheet |
| `pinterest-auto-pin-apps-script.gs` | The Apps Script: posts pins, refreshes tokens, weekly report, triggers |
| `test/mock_test.js` | Offline test: runs the script against mocked services and simulates 60 days |

## What runs where

- **Google Apps Script** (your account) does everything that talks to Pinterest or Google: posting, token
  refresh, GA4 and Pinterest analytics, the weekly email. It holds the credentials.
- **Claude** prepares content and code in this repo and opens PRs: new pins, new queue rows, script changes.
  Claude cannot reach Pinterest, Google or the live site from its sandbox, so it does not post, read
  analytics or touch the account. It can read the weekly report if you paste or share it.
- **You** merge PRs, import the CSV, and handle the Pinterest account, developer app and Google sheet.

## One-time setup

### 1. Pinterest Business account and domain claim
Create or convert to a Business account, then claim `bridgeandbowtravel.com` (Settings > Claimed accounts).
Use the HTML-tag method. The tag is already on `index.html`:
`<meta name="p:domain_verify" content="0e76731078002dd7f99f7532ff3b859d">`. Menu names change, so follow
what Pinterest shows.

### 2. Boards
Create these six boards **with exactly these names** (the script finds boards by name, so you never copy IDs):

| Board name | Description (paste into the board) |
|---|---|
| Cruise Ports & Shore Excursions for Families | Port guides and shore excursion ideas for cruise families: Cozumel, Nassau, Castaway Cay, Port Everglades and Galveston. Real tours researched on Viator, toddler-friendly beach days and what to skip with young kids, from our own Disney and Royal Caribbean sailings. |
| Royal Caribbean Cruise With a Baby | Cruising Royal Caribbean with a baby or toddler: our Voyager of the Seas sailing from Galveston to Cozumel with an 8-month-old, stateroom and dining notes, and a Cozumel beach day. |
| Disney Halloween on the High Seas | Disney Cruise Line's Halloween on the High Seas: what we saw on our Disney Destiny sailing, trick-or-treating with a toddler, and how to check that a sailing is a Halloween sailing before you book. |
| Disney Destiny Cruise Review & Photos | An honest Disney Destiny cruise review and photos from a 4-day, 3-night sailing out of Port Everglades with a toddler: staterooms, dining, kids' clubs, Castaway Cay and Nassau. |
| Disney Cruise Tips for Toddlers | Practical Disney cruise tips for toddlers and young kids: nursery and kids' clubs, the splash pad, seasickness prep, photo pass, airport transfers and more, from our own sailing. |
| Disney Cruise Planning: Booking, Ships & Packing | Plan a Disney cruise: when to book, how Disney pricing and payments work, and a toddler packing list for a family cruise. |

### 3. Pinterest developer app and tokens
1. Create an app at the Pinterest developer site (My apps). New apps start with **Trial access**.
2. Register a redirect URI on the app (any URL you control, for example `https://localhost/`).
3. Open the authorize URL in a browser where you are logged in to the Business account, with scopes
   `boards:read,boards:write,pins:read,pins:write,user_accounts:read` (Pinterest rejected pin creation without `boards:write`), `response_type=code`, your client ID, the
   redirect URI and any `state`. Approve. Copy the `code=` value from the address bar.
4. In Apps Script > Project Settings > Script Properties add: `PINTEREST_CLIENT_ID`,
   `PINTEREST_CLIENT_SECRET`, `PINTEREST_REDIRECT_URI`, `PINTEREST_AUTH_CODE`.
5. Run `exchangePinterestAuthCode()` once. It stores the access and refresh tokens and deletes the code.
6. Run `testPinterestConnection()`, then `listPinterestBoards()` (you should see the six boards above).

> **Trial access caveat.** Pinterest documents that pins and boards created with Trial access are not
> public; only you can see them. To post publicly, submit the app for **Standard access** (My apps >
> Upgrade). Pinterest asks for a video of the app making an API call, including the OAuth consent flow.
> No review time is published. Until it is approved, the pipeline works but pins stay private. Fallback:
> Pinterest's own bulk pin upload, reusing the titles and descriptions from the CSV (columns would need reformatting).

### 4. Sheet and script
1. In the existing Google Sheet add a tab named exactly `PinterestQueue`, then File > Import >
   `PinterestQueue.csv` > "Replace current sheet".
2. In the same Apps Script project as the forms script, add a file with the contents of
   `pinterest-auto-pin-apps-script.gs`. It reuses `SHEET_ID` and `NOTIFY_EMAIL` from `forms-apps-script.gs`,
   or set a `PINTEREST_SHEET_ID` Script Property instead.
3. For the weekly report: Services (+) > add **Google Analytics Data API** (identifier `AnalyticsData`), and
   add Script Property `GA4_PROPERTY_ID` (the numeric property ID from GA4 Admin > Property details, not
   the `G-` measurement ID).
4. Run `installPinterestTriggers()` once: daily posting at about 9am, weekly report Monday about 7am,
   weekly token refresh Sunday about 6am.
5. Merge the images PR **before** the first run. Pins read their image from
   `https://bridgeandbowtravel.com/assets/img/pins/...`, which only exists after GitHub Pages deploys.

## How the queue behaves

- Columns match by header name: `URL, PinTitle, PinDescription, ImageURL, BoardID, Type, Status, LastPosted,
  UTM Campaign, AltText, UTMContent, PinID, LastError`. `BoardID` accepts a board name or a numeric ID.
- `Type = new` posts once; `evergreen` re-posts on a 21-day cooldown. `Status = paused` skips a row.
- Per run: up to 2 new pins and 1 evergreen pin. Two pins to the same page are never posted within 5 days.
  With 33 evergreen rows that is about one full pass per 33 days. Tunable constants are at the top of the script.
- Every link gets `utm_source=pinterest&utm_medium=social&utm_campaign=<page>&utm_content=<variant>`.
- Failures are written to `LastError` and emailed; a clean run sends nothing.
- Bad rows (title over 100 characters, description over 800, off-site URL, unknown board) are skipped and recorded.

## Weekly report

`pinterestWeeklyReport()` emails a summary and appends rows to a `PinterestReport` tab:
sessions from Pinterest by landing page and by campaign/variant (GA4), Viator clicks from Pinterest sessions by
page and campaign (GA4 `viator_click` event), and per-pin impressions, saves and outbound clicks (Pinterest
analytics, pins posted in the last 90 days).

**GA4 counts only visitors who accept analytics cookies.** The site loads Google Analytics only after "Accept all",
so GA4 sessions and `viator_click` counts are a floor, not the full picture. Pinterest's own outbound-click numbers
count everyone, so expect the two to differ.

Not yet verified against the live APIs: the Pinterest per-pin analytics call and the GA4 report were written
from documentation and tested only against mocks. Run `pinterestWeeklyReport()` once from the editor after
the first pins are public and check the log. Fix any error before relying on the Monday email.

## Adding or changing pins (what Claude does)

Pin copy must match what the page says today. When a page changes or is removed (as Fantasy vs. Wish was),
update `pins_data.py` and delete the stale rows from the sheet.

1. Edit `pins_data.py` (facts from the page only, no prices, names or IDs).
2. `python3 tools/pinterest/make_pins.py` then `python3 tools/pinterest/build_queue.py`.
3. `node tools/pinterest/test/mock_test.js`.
4. Open a PR. After merge, import new rows into the sheet, or append them below existing rows.

Requirements: Python 3 with Pillow and OpenCV (`opencv-python-headless`), and DejaVu fonts.
`make_pins.py` only reads source photos from `assets/img/trip/` and re-encodes output, so no EXIF or GPS data
is carried into pins. A sticker with a number on one source photo is painted over in the generated pin only.

## Security

Never commit tokens, the client secret, an authorization code, the Sheet ID or board IDs. All of them live in
Script Properties. If a secret is ever committed, rotate it at Pinterest and in Google, then remove it from history.
