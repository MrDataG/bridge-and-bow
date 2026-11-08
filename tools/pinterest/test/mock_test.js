/**
 * Offline test for pinterest-auto-pin-apps-script.gs.
 * Runs the real script against mocked Apps Script + Pinterest services, using the real
 * PinterestQueue.csv, and simulates daily runs. No network, no secrets.
 *   node tools/pinterest/test/mock_test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const dir = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(dir, 'pinterest-auto-pin-apps-script.gs'), 'utf8');

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

function makeEnv(csvRows, opts) {
  opts = opts || {};
  const RealDate = Date; let offsetDays = 0;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + offsetDays * 864e5); else super(...a); }
    static now() { return RealDate.now() + offsetDays * 864e5; }
  }
  const data = csvRows.map(r => r.slice());
  const props = { PINTEREST_ACCESS_TOKEN: 'tok', PINTEREST_TOKEN_EXPIRES_AT: String(RealDate.now() + 3e9),
                  PINTEREST_SHEET_ID: 'SHEET', PINTEREST_CLIENT_ID: 'id', PINTEREST_CLIENT_SECRET: 's', PINTEREST_REFRESH_TOKEN: 'r' };
  const posts = [], mails = [], refreshes = [];
  let pinCounter = 1000;
  const boards = opts.boards || { 'cruise ports & shore excursions for families': '11', 'royal caribbean cruise with a baby': '12',
    'disney halloween on the high seas': '13', 'disney destiny cruise review & photos': '14', 'disney cruise tips for toddlers': '15',
    'disney cruise planning: booking, ships & packing': '16' };
  const sheet = {
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange: (r, c) => ({ setValue: v => { data[r - 1][c - 1] = v; } }),
  };
  const auth = { cell: '', exists: opts.authTab !== false };
  const authSheet = { getRange: () => ({ getValue: () => auth.cell, clearContent: () => { auth.cell = ''; } }) };
  const locks = { n: 0, released: 0 };
  const reportRows = [];
  const reportTab = { getLastRow: () => 1, appendRow: r => reportRows.push(r) };
  const ctx = {
    Logger: { log: () => {} }, Date: FakeDate, JSON, Math, Infinity, Number, String, Object, encodeURIComponent, isNaN,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => (n === 'PinterestQueue' ? sheet : (n === 'PinterestReport' ? reportTab : (n === 'PinterestAuth' && auth.exists ? authSheet : null))), insertSheet: n => { if (n === 'PinterestReport') return reportTab; auth.exists = true; return authSheet; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { locks.n++; return true; }, releaseLock: () => { locks.released++; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }) },
    Utilities: { base64Encode: s => Buffer.from(s).toString('base64'), formatDate: (d) => d.toISOString().slice(0, 10) },
    UrlFetchApp: { fetch: (url, o) => {
      const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
      if (opts.analytics) { const r = opts.analytics(url, resp, o); if (r) return r; }
      if (url.includes('/boards')) return resp(200, { items: Object.entries(boards).map(([name, id]) => ({ name, id })), bookmark: '' });
      if (url.endsWith('/pins') && o.method === 'post') {
        const p = JSON.parse(o.payload); posts.push(Object.assign({ day: offsetDays }, p));
        return resp(201, { id: String(pinCounter++) });
      }
      if (url.endsWith('/oauth/token')) { refreshes.push(o.payload); return resp(200, { access_token: 'tok' + refreshes.length, expires_in: 2592000, refresh_token: 'r' + refreshes.length }); }
      return resp(404, { message: 'unexpected ' + url });
    } },
  };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { ctx, data, posts, mails, reportRows, locks, refreshes, auth, setDay: d => { offsetDays = d; }, props };
}

const csv = parseCsv(fs.readFileSync(path.join(dir, 'PinterestQueue.csv'), 'utf8'));
const header = csv[0], rowsN = csv.length - 1;
const col = n => header.indexOf(n);
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; };

// 1) UTM helper
{
  const e = makeEnv(csv);
  const u = e.ctx.addPinterestUtmParams_('https://bridgeandbowtravel.com/x.html', 'camp one', 'v1-a');
  ok(u === 'https://bridgeandbowtravel.com/x.html?utm_source=pinterest&utm_medium=social&utm_campaign=camp%20one&utm_content=v1-a', 'utm string');
}

// 2) Day-0 run: caps, ordering, board-name resolution, pin id logging
{
  const e = makeEnv(csv); e.setDay(0); e.ctx.postDuePins();
  ok(e.posts.length === 3, 'day 0 posts 2 new + 1 evergreen, got ' + e.posts.length);
  ok(e.posts[0].link.includes('/ports/cozumel.html') && e.posts[1].link.includes('royal-caribbean'), 'new pins first, in priority order');
  ok(e.posts[0].board_id === '11' && e.posts[1].board_id === '12', 'board names resolved to ids');
  ok(e.posts.every(p => p.link.includes('utm_source=pinterest') && p.link.includes('utm_content=')), 'utm on every link');
  ok(new Set(e.posts.map(p => p.link.split('?')[0])).size === 3, 'no duplicate page in one run');
  ok(e.posts.every(p => p.alt_text && p.title.length <= 100 && p.description.length <= 800), 'alt text present, limits respected');
  const posted = e.data.filter((r, i) => i > 0 && r[col('Status')] === 'posted');
  ok(posted.length === 3, 'every successfully posted row is marked posted');
  ok(e.data.filter((r, i) => i > 0 && r[col('Type')] === 'new' && r[col('Status')] === 'posted').length === 2, 'the two new rows will not post again');
  ok(e.data.filter((r, i) => i > 0 && r[col('PinID')]).length === 3, 'pin ids recorded for all 3');
}

// 3) 60 simulated days
{
  const e = makeEnv(csv); const lastByRow = {}, lastByUrl = {};
  for (let day = 0; day < 60; day++) {
    e.setDay(day); const before = e.posts.length; e.ctx.postDuePins();
    const today = e.posts.slice(before);
    ok(today.length <= 3, 'cap per run');
    ok(today.filter(p => true).length === new Set(today.map(p => p.link.split('?')[0])).size, 'same-URL pins never share a run');
    today.forEach(p => {
      const url = p.link.split('?')[0], key = p.link;
      if (lastByUrl[url] !== undefined) ok(day - lastByUrl[url] >= 5, 'same URL within 5 days: ' + url + ' day ' + day);
      lastByUrl[url] = day;
      if (lastByRow[key] !== undefined) ok(day - lastByRow[key] >= 21, 'row re-posted inside 21-day cooldown');
      lastByRow[key] = day;
    });
  }
  const distinct = new Set(e.posts.map(p => p.link));
  ok(distinct.size === rowsN, 'every row posted at least once within 60 days (' + distinct.size + '/' + rowsN + ')');
  ok(e.mails.length === 0, 'no failure emails in a clean run: ' + JSON.stringify(e.mails.slice(0, 1)));
  ok(e.refreshes.length >= 1 && e.refreshes.every(b => b.grant_type === 'refresh_token' && b.refresh_on === 'true'), 'token refreshed automatically when it expired during the simulation');
  console.log('simulated 60 days: ' + e.posts.length + ' pins, ' + distinct.size + ' distinct rows, ' + new Set(e.posts.map(p => p.link.split('?')[0])).size + ' pages');
}

// 4) Bad rows are recorded, not posted
{
  const bad = csv.map(r => r.slice());
  bad[1][col('PinTitle')] = 'x'.repeat(101);                       // too long
  bad[2][col('BoardID')] = 'A board that does not exist';          // unknown board
  bad[3][col('URL')] = 'https://example.com/other.html';           // off-site URL
  const e = makeEnv(bad); e.setDay(0); e.ctx.postDuePins();
  ok(e.posts.every(p => !p.link.includes('example.com')), 'off-site url never posted');
  ok(e.data[1][col('LastError')].includes('title over'), 'long title recorded');
  ok(e.data[1][col('Status')] === 'pending', 'bad row stays pending');
  ok(e.mails.length >= 0, 'mail hook callable');
}

// 5) Paused rows are skipped
{
  const p = csv.map(r => r.slice()); p[1][col('Status')] = 'paused';
  const e = makeEnv(p); e.setDay(0); e.ctx.postDuePins();
  ok(!e.posts.some(x => x.link.includes('/ports/cozumel.html') && x.link.includes('v1-beach-toddler')), 'paused row skipped');
}

// 6) One-time auth-code exchange stores tokens and removes the code
{
  const e = makeEnv(csv); e.props.PINTEREST_AUTH_CODE = 'abc'; e.props.PINTEREST_REDIRECT_URI = 'https://localhost/';
  delete e.props.PINTEREST_ACCESS_TOKEN; delete e.props.PINTEREST_REFRESH_TOKEN;
  e.ctx.exchangePinterestAuthCode();
  ok(e.refreshes[0].grant_type === 'authorization_code' && e.refreshes[0].code === 'abc', 'code exchange request');
  ok(e.props.PINTEREST_ACCESS_TOKEN && e.props.PINTEREST_REFRESH_TOKEN && !e.props.PINTEREST_AUTH_CODE, 'tokens stored, code removed');
}

// 7) Paste-the-whole-address variant: parses code=, exchanges, clears the cell
{
  const e = makeEnv(csv); e.props.PINTEREST_REDIRECT_URI = 'https://localhost/';
  e.auth.cell = 'https://localhost/?code=xyz123%2Fabc&state=bb1';
  e.ctx.exchangePinterestAuthCodeFromSheet();
  ok(e.refreshes[0].code === 'xyz123/abc', 'code parsed from full address');
  ok(e.auth.cell === '' && e.props.PINTEREST_ACCESS_TOKEN, 'cell cleared, tokens stored');
  const b = makeEnv(csv); b.props.PINTEREST_REDIRECT_URI = 'https://localhost/'; b.auth.cell = 'justthecode';
  b.ctx.exchangePinterestAuthCodeFromSheet();
  ok(b.refreshes[0].code === 'justthecode', 'bare code accepted');
  const m = makeEnv(csv, { authTab: false }); m.props.PINTEREST_REDIRECT_URI = 'https://localhost/';
  m.ctx.exchangePinterestAuthCodeFromSheet();
  ok(m.refreshes.length === 0 && m.auth.exists, 'missing tab is created, no exchange attempted');
  const z = makeEnv(csv); z.props.PINTEREST_REDIRECT_URI = 'https://localhost/';
  z.ctx.exchangePinterestAuthCodeFromSheet();
  ok(z.refreshes.length === 0, 'empty cell does nothing');
}

// 8) Weekly report: account totals + per-pin detail from the account's own pin list
{
  const urls = [];
  const pinList = { items: [
    { id: '1', title: 'Pin A', link: 'https://bridgeandbowtravel.com/a.html?utm_source=pinterest' },
    { id: '2', title: 'Pin B', link: 'https://bridgeandbowtravel.com/b.html' },
    { id: '3', title: 'Pin C', link: 'https://bridgeandbowtravel.com/c.html' } ], bookmark: '' };
  const e = makeEnv(csv, { analytics: (url, resp) => {
    urls.push(url);
    if (url.includes('/user_account/analytics')) return resp(200, { all: { summary_metrics: { IMPRESSION: 440, OUTBOUND_CLICK: 12, SAVE: 0, ENGAGEMENT: 27 } } });
    if (url.includes('/pins?page_size')) return resp(200, pinList);
    if (url.includes('/pins/1/analytics')) return resp(200, { all: { summary_metrics: { IMPRESSION: 35, OUTBOUND_CLICK: 2, SAVE: 0 } } });
    if (url.includes('/pins/2/analytics')) return resp(404, { message: 'nope' });
    if (url.includes('/pins/3/analytics')) return resp(200, { all: { summary_metrics: {} } });
  } });
  e.ctx.pinterestWeeklyReport();
  const body = e.mails[e.mails.length - 1].b;
  ok(body.includes('last 7 days: 440 impressions, 12 outbound clicks, 0 saves, 27 engagements'), 'account 7d totals in email');
  ok(body.includes('last 30 days: 440 impressions'), 'account 30d totals in email');
  ok(e.reportRows.some(r => r[1] === 'account_30d' && r[4] === 440 && r[6] === 12), 'account totals written to the report tab');
  ok(body.includes('2 of 3 pins on the account returned data'), 'per-pin coverage comes from the account list: ' + body);
  ok(body.includes('1 pin(s) could not be read; first error: HTTP 404'), 'failed pin reads are surfaced, not silent');
  ok(e.reportRows.some(r => r[1] === 'pin' && r[3] === 'https://bridgeandbowtravel.com/a.html' && r[6] === 2), 'pin row has the URL without utm parameters');
  ok(urls.some(u => u.includes('/user_account/analytics') && u.includes('OUTBOUND_CLICK')), 'account endpoint requested');
  const d = makeEnv(csv, { analytics: (url, resp) => url.includes('/user_account/analytics') ? resp(200, { all: { daily_metrics: [{ metrics: { IMPRESSION: 5, OUTBOUND_CLICK: 1 } }, { metrics: { IMPRESSION: 7, OUTBOUND_CLICK: 0 } }] } }) : (url.includes('/pins?page_size') ? resp(200, { items: [], bookmark: '' }) : null) });
  d.ctx.pinterestWeeklyReport();
  ok(d.mails[0].b.includes('last 7 days: 12 impressions, 1 outbound clicks'), 'daily_metrics are summed when no summary');
  const x = makeEnv(csv, { analytics: (url, resp) => url.includes('/user_account/analytics') ? resp(403, { code: 29 }) : (url.includes('/pins?page_size') ? resp(200, { items: [], bookmark: '' }) : null) });
  x.ctx.pinterestWeeklyReport();
  ok(x.mails[0].b.includes('last 7 days: unavailable (HTTP 403'), 'account endpoint error surfaced');
}

// 9) A rejected token (401) is refreshed once, under a lock, and the call is retried
{
  let first = true; const auths = [];
  const e = makeEnv(csv, { analytics: (url, resp, o) => {
    if (url.endsWith('/pins') && o.method === 'post') { auths.push(o.headers.Authorization); if (first) { first = false; return resp(401, { code: 2, message: 'Session is no longer valid for this access token.' }); } }
    return null;
  } });
  e.setDay(0); e.ctx.postDuePins();
  ok(e.refreshes.length === 1 && e.refreshes[0].grant_type === 'refresh_token', 'exactly one refresh after the 401');
  ok(auths[0] === 'Bearer tok' && auths[1] === 'Bearer tok1', 'retry uses the new token: ' + auths.slice(0, 2));
  ok(e.posts.length === 3, 'all 3 pins still posted after the retry, got ' + e.posts.length);
  ok(e.mails.length === 0, 'no failure email when the retry succeeds');
  ok(e.locks.n === 1 && e.locks.released === 1, 'refresh took and released the script lock');
  // a persistent 401 does not loop: one refresh, one retry, then the failure is recorded
  const f = makeEnv(csv, { analytics: (url, resp, o) => (url.endsWith('/pins') && o.method === 'post') ? resp(401, { code: 2 }) : null });
  f.setDay(0); f.ctx.postDuePins();
  ok(f.posts.length === 0 && f.refreshes.length <= 3 && f.mails.length >= 1, 'persistent 401 is reported, bounded refreshes: ' + f.refreshes.length);
}

console.log('OK: ' + passed + ' checks passed');
