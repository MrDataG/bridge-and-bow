/**
 * Bridge & Bow Travel — Form handler (Newsletter + Contact)
 * Paste this into Extensions > Apps Script in the Google Sheet,
 * then deploy as a Web App (see deployment instructions).
 *
 * SETUP: This expects two tabs in the spreadsheet, named exactly:
 *   "Newsletter"  — columns: Timestamp | Email | Source Page
 *   "Contact"     — columns: Timestamp | Name | Email | Message
 * Create both tabs before deploying (rename Sheet1, add a second tab).
 *
 * Set NOTIFY_EMAIL below to where contact-form alerts should be sent.
 */
var NOTIFY_EMAIL = 'bridgeandbowtravel@gmail.com';

function doPost(e) {
  var formType = e.parameter.formType || 'newsletter';

  if (formType === 'contact') {
    return handleContact(e);
  }
  return handleNewsletter(e);
}

function handleNewsletter(e) {
  var email = (e.parameter.email || '').trim();
  var source = e.parameter.source || '';

  if (!email || email.indexOf('@') === -1) {
    return jsonResponse({ result: 'error', message: 'Invalid email' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Newsletter');
  sheet.appendRow([new Date(), email, source]);

  return jsonResponse({ result: 'success' });
}

function handleContact(e) {
  var name = (e.parameter.name || '').trim();
  var email = (e.parameter.email || '').trim();
  var message = (e.parameter.message || '').trim();

  if (!name || !email || email.indexOf('@') === -1 || !message) {
    return jsonResponse({ result: 'error', message: 'Missing required fields' });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Contact');
  sheet.appendRow([new Date(), name, email, message]);

  // Email alert so contact messages don't sit unseen in a sheet
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'Bridge & Bow Travel — New contact message from ' + name,
    body: 'Name: ' + name + '\nEmail: ' + email + '\n\nMessage:\n' + message
  });

  return jsonResponse({ result: 'success' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

