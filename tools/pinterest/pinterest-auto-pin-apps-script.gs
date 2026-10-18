/**
 * Bridge & Bow Travel — Pinterest Auto-Pin Automation
 * ----------------------------------------------------
 * Posts pins to Pinterest from a Google Sheet queue ("PinterestQueue" tab) and
 * sends a weekly clicks report. Full setup steps: tools/pinterest/README.md.
 *
 * NO SECRETS IN THIS FILE. This copy is safe for the public repo:
 *  - Pinterest tokens, client ID/secret and the Sheet ID live in Script
 *    Properties (Project Settings > Script Properties), never in code.
 *  - The Sheet ID is read from the PINTEREST_SHEET_ID property, or from the
 *    SHEET_ID global that forms-apps-script.gs already defines in the same
 *    Apps Script project.
 *
 * Apps Script shares ONE global namespace per project. Everything here is
 * prefixed PINTEREST_ / pinterest or ends in an underscore so it cannot
 * collide with doPost, SHEET_ID, NOTIFY_EMAIL, etc. in the other files.
 *
 * Queue columns (matched by header name, spaces ignored, any order):
 *   URL | PinTitle | PinDescription | ImageURL | BoardID | Type | Status |
 *   LastPosted | UTM Campaign | AltText | UTMContent | PinID | LastError
 *  - BoardID may be a numeric board ID OR the exact board name; names are
 *    resolved through the API, so you never have to copy IDs by hand.
 *  - Type: "new" posts once (Status pending -> posted); "evergreen" re-posts
 *    on a cooldown. Status "paused" skips a row.
 */

var PINTEREST_SHEET_TAB = 'PinterestQueue';
var PINTEREST_REPORT_TAB = 'PinterestReport';
var PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
var PINTEREST_SITE_ORIGIN = 'https://bridgeandbowtravel.com';

// An evergreen row (one pin variant) is re-posted no more often than this.
var PINTEREST_EVERGREEN_COOLDOWN_DAYS = 21;
// Two pins that link to the same page are never posted closer together than this.
var PINTEREST_MIN_DAYS_BETWEEN_SAME_URL = 5;
// Per-run caps (rate-limit and spam safety).
var PINTEREST_MAX_NEW_PINS_PER_RUN = 2;
var PINTEREST_MAX_EVERGREEN_PINS_PER_RUN = 1;
// Pinterest limits: title 100, description 800 characters.
var PINTEREST_TITLE_MAX = 100;
var PINTEREST_DESCRIPTION_MAX = 800;

/* ------------------------------------------------------------------ */
/* Posting                                                             */
/* ------------------------------------------------------------------ */

/** Main entry point — wired to a daily time trigger by installPinterestTriggers(). */
function postDuePins() {
  var props = PropertiesService.getScriptProperties();
  var accessToken = getValidPinterestAccessToken_(props);
  if (!accessToken) {
    notifyPinterestFailure_('Could not obtain a valid Pinterest access token. Check Script Properties / refresh token.');
    return;
  }

  var sheet = pinterestQueueSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('Queue is empty.'); return; }
  var col = pinterestColMap_(data[0]);
  var plan = pinterestPlanRun_(data, col, new Date());

  var boards = null; // resolved lazily, only if a row uses a board name
  var postedNew = 0, postedEvergreen = 0;

  for (var n = 0; n < plan.newRows.length; n++) {
    if (pinterestPostRow_(sheet, data[plan.newRows[n]], plan.newRows[n], col, accessToken, props, function () { return boards || (boards = pinterestBoardMap_(accessToken)); })) postedNew++;
  }
  for (var e = 0; e < plan.evergreenRows.length; e++) {
    if (pinterestPostRow_(sheet, data[plan.evergreenRows[e]], plan.evergreenRows[e], col, accessToken, props, function () { return boards || (boards = pinterestBoardMap_(accessToken)); })) postedEvergreen++;
  }
  Logger.log('Posted ' + postedNew + ' new pin(s) and ' + postedEvergreen + ' evergreen pin(s).');
}

/**
 * Pure selection logic (no API calls): which rows to post this run.
 * - "new" + pending rows first (up to the cap), then the stalest evergreen rows.
 * - Never two pins to the same URL in one run, and never within
 *   PINTEREST_MIN_DAYS_BETWEEN_SAME_URL days of the last pin to that URL.
 */
function pinterestPlanRun_(data, col, now) {
  var lastByUrl = {};   // url -> most recent LastPosted (ms)
  var i, row, t;
  for (i = 1; i < data.length; i++) {
    row = data[i];
    if (row[col.LastPosted]) {
      t = new Date(row[col.LastPosted]).getTime();
      if (!isNaN(t) && (!lastByUrl[row[col.URL]] || t > lastByUrl[row[col.URL]])) lastByUrl[row[col.URL]] = t;
    }
  }
  function urlIsFree(url) {
    if (!lastByUrl[url]) return true;
    return pinterestDaysBetween_(new Date(lastByUrl[url]), now) >= PINTEREST_MIN_DAYS_BETWEEN_SAME_URL;
  }

  var newCandidates = [], evergreenCandidates = [];
  for (i = 1; i < data.length; i++) {
    row = data[i];
    if (!row[col.URL]) continue;
    var type = String(row[col.Type] || '').toLowerCase();
    var status = String(row[col.Status] || '').toLowerCase();
    if (status === 'paused') continue;
    if (type === 'new' && status !== 'posted') {
      newCandidates.push(i);
    } else if (type === 'evergreen') {
      var lp = row[col.LastPosted];
      var days = lp ? pinterestDaysBetween_(new Date(lp), now) : Infinity;
      if (days >= PINTEREST_EVERGREEN_COOLDOWN_DAYS) evergreenCandidates.push({ rowIndex: i, daysSince: days });
    }
  }
  evergreenCandidates.sort(function (a, b) { return b.daysSince - a.daysSince; });

  var usedUrls = {}, plan = { newRows: [], evergreenRows: [] };
  newCandidates.forEach(function (idx) {
    var url = data[idx][col.URL];
    if (plan.newRows.length >= PINTEREST_MAX_NEW_PINS_PER_RUN || usedUrls[url] || !urlIsFree(url)) return;
    usedUrls[url] = true; plan.newRows.push(idx);
  });
  evergreenCandidates.forEach(function (c) {
    var url = data[c.rowIndex][col.URL];
    if (plan.evergreenRows.length >= PINTEREST_MAX_EVERGREEN_PINS_PER_RUN || usedUrls[url] || !urlIsFree(url)) return;
    usedUrls[url] = true; plan.evergreenRows.push(c.rowIndex);
  });
  return plan;
}

/** Posts one row. Returns true on success; on failure records LastError and emails. */
function pinterestPostRow_(sheet, row, rowIndex, col, accessToken, props, getBoards) {
  var url = row[col.URL];
  var title = String(row[col.PinTitle] || '');
  var description = String(row[col.PinDescription] || '');
  var imageUrl = row[col.ImageURL];
  var boardRef = String(row[col.BoardID] || props.getProperty('PINTEREST_DEFAULT_BOARD_ID') || '').trim();
  var utmCampaign = row[col.UTMCampaign] || 'auto_pin';
  var utmContent = col.UTMContent !== undefined ? row[col.UTMContent] : '';
  var altText = col.AltText !== undefined ? String(row[col.AltText] || '') : '';

  var problem = '';
  if (!url || !title || !imageUrl || !boardRef) problem = 'missing required field(s)';
  else if (String(url).indexOf(PINTEREST_SITE_ORIGIN) !== 0) problem = 'URL is not on ' + PINTEREST_SITE_ORIGIN;
  else if (title.length > PINTEREST_TITLE_MAX) problem = 'title over ' + PINTEREST_TITLE_MAX + ' characters';
  else if (description.length > PINTEREST_DESCRIPTION_MAX) problem = 'description over ' + PINTEREST_DESCRIPTION_MAX + ' characters';
  if (problem) return pinterestRecordError_(sheet, rowIndex, col, 'Row ' + (rowIndex + 1) + ': ' + problem, url, false);

  var boardId = boardRef;
  if (!/^\d+$/.test(boardRef)) {
    boardId = getBoards()[boardRef.toLowerCase()];
    if (!boardId) return pinterestRecordError_(sheet, rowIndex, col, 'No board named "' + boardRef + '" found on the account.', url, true);
  }

  var payload = {
    link: addPinterestUtmParams_(url, utmCampaign, utmContent),
    title: title,
    description: description,
    board_id: boardId,
    media_source: { source_type: 'image_url', url: imageUrl }
  };
  if (altText) payload.alt_text = altText.slice(0, 500);

  var response = UrlFetchApp.fetch(PINTEREST_API_BASE + '/pins', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    var pinId = '';
    try { pinId = JSON.parse(response.getContentText()).id || ''; } catch (err) { /* keep blank */ }
    sheet.getRange(rowIndex + 1, col.Status + 1).setValue('posted');
    sheet.getRange(rowIndex + 1, col.LastPosted + 1).setValue(new Date());
    if (col.PinID !== undefined) sheet.getRange(rowIndex + 1, col.PinID + 1).setValue(pinId);
    if (col.LastError !== undefined) sheet.getRange(rowIndex + 1, col.LastError + 1).setValue('');
    Logger.log('Posted pin ' + pinId + ' for ' + url);
    return true;
  }
  return pinterestRecordError_(sheet, rowIndex, col, 'HTTP ' + code + ': ' + response.getContentText(), url, true);
}

function pinterestRecordError_(sheet, rowIndex, col, message, url, notify) {
  Logger.log('Pinterest problem for ' + url + ' — ' + message);
  if (col.LastError !== undefined) sheet.getRange(rowIndex + 1, col.LastError + 1).setValue(new Date().toISOString() + ' ' + message.slice(0, 300));
  if (notify) notifyPinterestFailure_('Pinterest pin failed for ' + url + '\n' + message);
  return false;
}

/** name (lowercase) -> board id, for every board on the account. */
function pinterestBoardMap_(accessToken) {
  var map = {}, bookmark = '';
  do {
    var res = UrlFetchApp.fetch(PINTEREST_API_BASE + '/boards?page_size=250' + (bookmark ? '&bookmark=' + encodeURIComponent(bookmark) : ''), {
      headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) { Logger.log('Could not list boards: ' + res.getContentText()); break; }
    var body = JSON.parse(res.getContentText());
    (body.items || []).forEach(function (b) { map[String(b.name).toLowerCase()] = b.id; });
    bookmark = body.bookmark || '';
  } while (bookmark);
  return map;
}

/** Run once from the editor after boards exist: logs "id  name" for every board. */
function listPinterestBoards() {
  var props = PropertiesService.getScriptProperties();
  var map = pinterestBoardMap_(getValidPinterestAccessToken_(props));
  Object.keys(map).forEach(function (name) { Logger.log(map[name] + '  ' + name); });
  Logger.log(Object.keys(map).length + ' board(s).');
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Access tokens last ~30 days and refresh tokens ~60 days; each refresh renews both. */
function getValidPinterestAccessToken_(props) {
  var token = props.getProperty('PINTEREST_ACCESS_TOKEN');
  var expiresAt = Number(props.getProperty('PINTEREST_TOKEN_EXPIRES_AT') || 0);
  if (token && expiresAt && Date.now() < expiresAt - 5 * 60 * 1000) return token;
  // No expiry recorded yet (first run after pasting a token): refresh once to learn it.
  return refreshPinterestAccessToken_(props) || (token && !expiresAt ? token : null);
}

function refreshPinterestAccessToken_(props) {
  var clientId = props.getProperty('PINTEREST_CLIENT_ID');
  var clientSecret = props.getProperty('PINTEREST_CLIENT_SECRET');
  var refreshToken = props.getProperty('PINTEREST_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    Logger.log('Missing client credentials or refresh token in Script Properties.');
    return null;
  }
  var response = UrlFetchApp.fetch(PINTEREST_API_BASE + '/oauth/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret) },
    // refresh_on=true asks Pinterest for continuous refresh tokens, so the
    // pipeline keeps running unattended as long as it refreshes at least every 60 days.
    payload: { grant_type: 'refresh_token', refresh_token: refreshToken, refresh_on: 'true' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    Logger.log('Token refresh failed: ' + response.getContentText());
    return null;
  }
  var body = JSON.parse(response.getContentText());
  props.setProperty('PINTEREST_ACCESS_TOKEN', body.access_token);
  props.setProperty('PINTEREST_TOKEN_EXPIRES_AT', String(Date.now() + (body.expires_in * 1000)));
  if (body.refresh_token) props.setProperty('PINTEREST_REFRESH_TOKEN', body.refresh_token);
  return body.access_token;
}

/**
 * One-time: turns the authorization code from Pinterest's consent screen into
 * access + refresh tokens, so nobody has to run curl. Before running, add Script
 * Properties PINTEREST_AUTH_CODE (the ?code=... value from the redirect URL) and
 * PINTEREST_REDIRECT_URI (exactly the redirect URI registered on the Pinterest app).
 * The code is single-use and short-lived; it is deleted from properties afterwards.
 */
function exchangePinterestAuthCode() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('PINTEREST_CLIENT_ID');
  var clientSecret = props.getProperty('PINTEREST_CLIENT_SECRET');
  var code = props.getProperty('PINTEREST_AUTH_CODE');
  var redirect = props.getProperty('PINTEREST_REDIRECT_URI');
  if (!clientId || !clientSecret || !code || !redirect) {
    Logger.log('Need PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_AUTH_CODE and PINTEREST_REDIRECT_URI in Script Properties.');
    return;
  }
  var response = UrlFetchApp.fetch(PINTEREST_API_BASE + '/oauth/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret) },
    payload: { grant_type: 'authorization_code', code: code, redirect_uri: redirect, refresh_on: 'true' },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    Logger.log('Code exchange failed (codes are single-use; authorize again for a new one): ' + response.getContentText());
    return;
  }
  var body = JSON.parse(response.getContentText());
  props.setProperty('PINTEREST_ACCESS_TOKEN', body.access_token);
  props.setProperty('PINTEREST_REFRESH_TOKEN', body.refresh_token);
  props.setProperty('PINTEREST_TOKEN_EXPIRES_AT', String(Date.now() + (body.expires_in * 1000)));
  props.deleteProperty('PINTEREST_AUTH_CODE');
  Logger.log('Tokens saved. Scope granted: ' + body.scope + '. Now run testPinterestConnection().');
}

/** Keeps the refresh token alive even if posting is paused. Wired to a weekly trigger. */
function keepPinterestTokenFresh() {
  if (!refreshPinterestAccessToken_(PropertiesService.getScriptProperties())) {
    notifyPinterestFailure_('Pinterest token refresh failed. Re-authorize the app and update PINTEREST_REFRESH_TOKEN in Script Properties.');
  }
}

/** One-time check: confirms credentials work and shows which account they belong to. */
function testPinterestConnection() {
  var token = getValidPinterestAccessToken_(PropertiesService.getScriptProperties());
  if (!token) { Logger.log('FAILED: could not obtain access token.'); return; }
  var r = UrlFetchApp.fetch(PINTEREST_API_BASE + '/user_account', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  Logger.log('Status ' + r.getResponseCode() + ': ' + r.getContentText());
}

/* ------------------------------------------------------------------ */
/* Weekly report: which pins and pages get clicks                      */
/* ------------------------------------------------------------------ */

/**
 * Needs: Advanced Google service "Google Analytics Data API" (identifier AnalyticsData)
 * enabled in the Apps Script project, plus Script Property GA4_PROPERTY_ID
 * (the numeric property ID, NOT the G-... measurement ID).
 * Writes dated rows to the PinterestReport tab and emails a summary.
 */
function pinterestWeeklyReport() {
  var props = PropertiesService.getScriptProperties();
  var ss = pinterestSpreadsheet_();
  var tab = ss.getSheetByName(PINTEREST_REPORT_TAB) || ss.insertSheet(PINTEREST_REPORT_TAB);
  if (tab.getLastRow() === 0) tab.appendRow(['ReportDate', 'Section', 'Key1', 'Key2', 'Metric1', 'Metric2', 'Metric3']);
  var today = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  var lines = ['Pinterest weekly report — ' + today + ' (last 7 days)', ''];

  // 1) GA4: sessions from Pinterest by landing page and by campaign/content
  var propertyId = props.getProperty('GA4_PROPERTY_ID');
  if (!propertyId || typeof AnalyticsData === 'undefined') {
    lines.push('GA4 section skipped: set GA4_PROPERTY_ID and enable the Google Analytics Data API advanced service.');
  } else {
    try {
      var pinterestOnly = { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'EXACT', value: 'pinterest' } } };
      var pages = pinterestGa4Rows_(propertyId, ['landingPage'], ['sessions', 'engagedSessions'], pinterestOnly);
      lines.push('Sessions from Pinterest by landing page:');
      pages.forEach(function (r) { tab.appendRow([today, 'ga4_landing', r.dims[0], '', r.mets[0], r.mets[1], '']); lines.push('  ' + r.dims[0] + ' — ' + r.mets[0] + ' sessions, ' + r.mets[1] + ' engaged'); });
      if (!pages.length) lines.push('  none yet');

      var camps = pinterestGa4Rows_(propertyId, ['sessionCampaign', 'sessionManualAdContent'], ['sessions'], pinterestOnly);
      lines.push('', 'Sessions by campaign / pin variant (utm_campaign / utm_content):');
      camps.forEach(function (r) { tab.appendRow([today, 'ga4_campaign', r.dims[0], r.dims[1], r.mets[0], '', '']); lines.push('  ' + r.dims[0] + ' / ' + r.dims[1] + ' — ' + r.mets[0]); });
      if (!camps.length) lines.push('  none yet');

      var clickFilter = { andGroup: { expressions: [pinterestOnly, { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'viator_click' } } }] } };
      var clicks = pinterestGa4Rows_(propertyId, ['pagePath', 'sessionCampaign'], ['eventCount'], clickFilter);
      lines.push('', 'Viator clicks from Pinterest sessions (page / campaign):');
      clicks.forEach(function (r) { tab.appendRow([today, 'ga4_viator_click', r.dims[0], r.dims[1], r.mets[0], '', '']); lines.push('  ' + r.dims[0] + ' / ' + r.dims[1] + ' — ' + r.mets[0] + ' click(s)'); });
      if (!clicks.length) lines.push('  none yet');
    } catch (err) {
      lines.push('GA4 section failed: ' + err);
    }
  }

  // 2) Pinterest: per-pin impressions, saves and outbound clicks for pins posted in the last 90 days
  try {
    var token = getValidPinterestAccessToken_(props);
    var sheet = pinterestQueueSheet_();
    var data = sheet.getDataRange().getValues();
    var col = pinterestColMap_(data[0]);
    if (token && col.PinID !== undefined) {
      var end = new Date(), start = new Date(end.getTime() - 7 * 86400000);
      var fmt = function (d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); };
      var rows = [];
      for (var i = 1; i < data.length && rows.length < 60; i++) {
        var pinId = data[i][col.PinID], lp = data[i][col.LastPosted];
        if (!pinId || !lp || pinterestDaysBetween_(new Date(lp), end) > 90) continue;
        var res = UrlFetchApp.fetch(PINTEREST_API_BASE + '/pins/' + pinId + '/analytics?start_date=' + fmt(start) + '&end_date=' + fmt(end) +
          '&metric_types=IMPRESSION,OUTBOUND_CLICK,SAVE', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) { Logger.log('Analytics ' + pinId + ': ' + res.getContentText()); continue; }
        var summary = (JSON.parse(res.getContentText()).all || {}).summary_metrics || {};
        rows.push({ title: data[i][col.PinTitle], url: data[i][col.URL], imp: summary.IMPRESSION || 0, clk: summary.OUTBOUND_CLICK || 0, sav: summary.SAVE || 0 });
      }
      rows.sort(function (a, b) { return b.clk - a.clk || b.imp - a.imp; });
      lines.push('', 'Pins by outbound clicks (Pinterest analytics, last 7 days):');
      rows.slice(0, 15).forEach(function (r) { tab.appendRow([today, 'pin', r.title, r.url, r.imp, r.sav, r.clk]); lines.push('  ' + r.clk + ' clicks, ' + r.imp + ' impressions, ' + r.sav + ' saves — ' + r.title); });
      if (!rows.length) lines.push('  no pins with analytics yet');
    }
  } catch (err2) {
    lines.push('', 'Pinterest analytics section failed: ' + err2);
  }

  var to = pinterestNotifyEmail_();
  if (to) MailApp.sendEmail(to, 'Bridge & Bow — Pinterest weekly report ' + today, lines.join('\n'));
  Logger.log(lines.join('\n'));
}

/** Runs one GA4 report for the last 7 days; returns [{dims:[], mets:[]}]. */
function pinterestGa4Rows_(propertyId, dims, mets, dimensionFilter) {
  var request = {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
    dimensions: dims.map(function (d) { return { name: d }; }),
    metrics: mets.map(function (m) { return { name: m }; }),
    dimensionFilter: dimensionFilter,
    orderBys: [{ metric: { metricName: mets[0] }, desc: true }],
    limit: 50
  };
  var report = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
  return (report.rows || []).map(function (r) {
    return { dims: r.dimensionValues.map(function (v) { return v.value; }), mets: r.metricValues.map(function (v) { return Number(v.value); }) };
  });
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

/** Run ONCE from the editor. Replaces any existing triggers for these functions. */
function installPinterestTriggers() {
  var ours = { postDuePins: 1, pinterestWeeklyReport: 1, keepPinterestTokenFresh: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) { if (ours[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('postDuePins').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('pinterestWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  ScriptApp.newTrigger('keepPinterestTokenFresh').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(6).create();
  Logger.log('Installed: daily post at ~9am, weekly report Monday ~7am, weekly token refresh Sunday ~6am (script time zone).');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function pinterestSheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('PINTEREST_SHEET_ID');
  if (!id && typeof SHEET_ID !== 'undefined' && SHEET_ID && SHEET_ID.indexOf('PASTE_') !== 0) id = SHEET_ID;
  if (!id) throw new Error('Set the PINTEREST_SHEET_ID Script Property (or define SHEET_ID in the same project).');
  return id;
}
function pinterestSpreadsheet_() { return SpreadsheetApp.openById(pinterestSheetId_()); }
function pinterestQueueSheet_() {
  var sheet = pinterestSpreadsheet_().getSheetByName(PINTEREST_SHEET_TAB);
  if (!sheet) throw new Error('Tab "' + PINTEREST_SHEET_TAB + '" not found.');
  return sheet;
}
function pinterestNotifyEmail_() {
  if (typeof NOTIFY_EMAIL !== 'undefined' && NOTIFY_EMAIL) return NOTIFY_EMAIL;
  return Session.getEffectiveUser().getEmail();
}

function addPinterestUtmParams_(url, campaign, content) {
  var sep = url.indexOf('?') === -1 ? '?' : '&';
  var out = url + sep + 'utm_source=pinterest&utm_medium=social&utm_campaign=' + encodeURIComponent(campaign);
  if (content) out += '&utm_content=' + encodeURIComponent(content);
  return out;
}

function pinterestDaysBetween_(a, b) { return Math.floor((b.getTime() - a.getTime()) / 86400000); }

function pinterestColMap_(header) {
  var map = {};
  for (var i = 0; i < header.length; i++) map[String(header[i]).replace(/\s+/g, '')] = i;
  return map;
}

function notifyPinterestFailure_(message) {
  try {
    var email = pinterestNotifyEmail_();
    if (email) MailApp.sendEmail(email, 'Pinterest Auto-Pin — action needed', message);
  } catch (err) {
    Logger.log('Could not send failure notification email: ' + err);
  }
}
