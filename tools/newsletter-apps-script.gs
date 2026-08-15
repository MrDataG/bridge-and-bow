/**
 * Bridge & Bow Travel — Newsletter signup handler
 * Paste this into Extensions > Apps Script in the Google Sheet,
 * then deploy as a Web App (see deployment instructions).
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var email = e.parameter.email || '';
  var source = e.parameter.source || '';

  // Basic validation — reject empty or obviously malformed emails
  if (!email || email.indexOf('@') === -1) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Invalid email' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([new Date(), email, source]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}
