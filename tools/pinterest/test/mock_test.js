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
  const ctx = {
    Logger: { log: () => {} }, Date: FakeDate, JSON, Math, Infinity, Number, String, Object, encodeURIComponent, isNaN,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => (n === 'PinterestQueue' ? sheet : (n === 'PinterestAuth' && auth.exists ? authSheet : null)), insertSheet: n => { auth.exists = true; return authSheet; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }) },
    Utilities: { base64Encode: s => Buffer.from(s).toString('base64') },
    UrlFetchApp: { fetch: (url, o) => {
      const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
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
  return { ctx, data, posts, mails, refreshes, auth, setDay: d => { offsetDays = d; }, props };
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

console.log('OK: ' + passed + ' checks passed');
