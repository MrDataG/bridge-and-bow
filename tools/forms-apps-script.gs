/**
 * Bridge & Bow Travel — Form handler (Newsletter + Contact)
 * Paste this into Extensions > Apps Script in the Google Sheet,
 * then deploy as a Web App (see deployment instructions).
 *
 * SETUP:
 * 1. Set SHEET_ID below to your spreadsheet's ID (from its URL:
 *    docs.google.com/spreadsheets/d/THIS_PART_HERE/edit)
 * 2. Create two tabs in that spreadsheet, named exactly:
 *      "Newsletter"  — columns: Timestamp | Email | Source Page
 *      "Contact"     — columns: Timestamp | Name | Email | Message
 * 3. Set NOTIFY_EMAIL to where contact-form alerts should go.
 * 4. Deploy as Web App (Execute as: Me, Who has access: Anyone).
 *
 * Uses SpreadsheetApp.openById() rather than getActiveSpreadsheet() —
 * the latter can silently fail when the script runs as a Web App
 * triggered externally, since there's no "active" sheet UI context
 * outside the editor. openById() is the reliable pattern for this.
 */
var SHEET_ID = '1rR4YPHnFWcb98iY0b0AYmhiq-kkcF1vSsjpScwjGvEs';
var NOTIFY_EMAIL = 'bridgeandbowtravel@gmail.com';

function doPost(e) {
  try {
    var formType = e.parameter.formType || 'newsletter';
    if (formType === 'contact') {
      return handleContact(e);
    }
    return handleNewsletter(e);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function handleNewsletter(e) {
  var email = (e.parameter.email || '').trim();
  var source = e.parameter.source || '';

  if (!email || email.indexOf('@') === -1) {
    return jsonResponse({ status: 'error', message: 'Invalid email' });
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Newsletter');
  if (!sheet) {
    return jsonResponse({ status: 'error', message: 'Newsletter tab not found — check tab name matches exactly' });
  }
  sheet.appendRow([new Date(), email, source]);

  return jsonResponse({ status: 'ok' });
}

function handleContact(e) {
  var name = (e.parameter.name || '').trim();
  var email = (e.parameter.email || '').trim();
  var message = (e.parameter.message || '').trim();

  if (!name || !email || email.indexOf('@') === -1 || !message) {
    return jsonResponse({ status: 'error', message: 'Missing required fields' });
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Contact');
  if (!sheet) {
    return jsonResponse({ status: 'error', message: 'Contact tab not found — check tab name matches exactly' });
  }
  sheet.appendRow([new Date(), name, email, message]);

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'Bridge & Bow Travel — New contact message from ' + name,
    body: 'Name: ' + name + '\nEmail: ' + email + '\n\nMessage:\n' + message
  });

  return jsonResponse({ status: 'ok' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Manual test functions — run these directly from the Apps Script
 * editor (select function from dropdown, click Run) to test the
 * sheet-writing logic WITHOUT going through the website or fetch().
 * Check the Executions log or View > Logs after running.
 */
function testNewsletter() {
  var mockEvent = {
    parameter: {
      formType: 'newsletter',
      email: 'test@example.com',
      source: '/index.html'
    }
  };
  Logger.log(doPost(mockEvent).getContent());
}

function testContact() {
  var mockEvent = {
    parameter: {
      formType: 'contact',
      name: 'Test User',
      email: 'test@example.com',
      message: 'This is a test message.'
    }
  };
  Logger.log(doPost(mockEvent).getContent());
}

