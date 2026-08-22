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

/**
 * =====================================================================
 * WEEKLY DEAL ALERT SENDER
 * =====================================================================
 * Reuses the same SHEET_ID and NOTIFY_EMAIL defined at the top of this file.
 *
 * SETUP (one-time):
 * 1. In your spreadsheet, add a new tab named exactly "Weekly Email"
 *    with these cells:
 *      B1 = (leave blank — you'll type the subject here each week)
 *      B2 = (leave blank — you'll type the email body here each week)
 *      B3 = FALSE   (this is a checkbox — Data > Data validation > Checkbox)
 *      B4 = (leave blank — script writes the last-sent date here automatically)
 *    Put labels in column A for your own reference: "Subject", "Body",
 *    "Ready to send?", "Last sent".
 *
 * 2. In the Apps Script editor, click the clock icon (Triggers) on the
 *    left sidebar > Add Trigger:
 *      Function to run: sendWeeklyDealEmail
 *      Event source: Time-driven
 *      Type: Week timer
 *      Day + time: whatever day/time you want it to check (e.g. Monday, 9am)
 *    Save.
 *
 * HOW TO USE IT EACH WEEK:
 * 1. Go to the "Weekly Email" tab, type your subject in B1, your deal
 *    content in B2.
 * 2. Check the box in B3 (mark it TRUE).
 * 3. Do nothing else — the trigger sends it automatically at the next
 *    scheduled run, then unchecks B3 for you so it can't resend by mistake.
 * 4. If B3 is left unchecked, nothing gets sent that week — totally fine,
 *    skip a week whenever you don't have anything worth sending.
 *
 * NOTE ON SENDING LIMITS: a personal Gmail account can send roughly
 * 100 emails per day via Apps Script. Fine for a growing list, but if
 * your Newsletter tab passes that, sends will start failing and you'd
 * need to move to a real email service (ConvertKit/MailerLite) instead.
 */
function sendWeeklyDealEmail() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var emailSheet = ss.getSheetByName('Weekly Email');
  if (!emailSheet) {
    Logger.log('No "Weekly Email" tab found — check the tab name.');
    return;
  }

  var readyToSend = emailSheet.getRange('B3').getValue();
  if (readyToSend !== true) {
    Logger.log('Not marked ready to send this week — skipping.');
    return;
  }

  var subject = (emailSheet.getRange('B1').getValue() || '').toString().trim();
  var body = (emailSheet.getRange('B2').getValue() || '').toString().trim();

  if (!subject || !body) {
    Logger.log('Subject or body is empty — skipping send to avoid sending a blank email.');
    return;
  }

  var newsletterSheet = ss.getSheetByName('Newsletter');
  if (!newsletterSheet) {
    Logger.log('No "Newsletter" tab found.');
    return;
  }

  var data = newsletterSheet.getDataRange().getValues();
  // Column B is Email (A=Timestamp, B=Email, C=Source Page) — skip header row
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    var email = (data[i][1] || '').toString().trim();
    if (email && email.indexOf('@') !== -1 && emails.indexOf(email) === -1) {
      emails.push(email);
    }
  }

  var footer = '\n\n---\nYou\'re receiving this because you signed up at bridgeandbowtravel.com. ' +
    'To unsubscribe, reply to this email with "unsubscribe" and we\'ll remove you.';

  var sentCount = 0;
  var failedCount = 0;
  for (var j = 0; j < emails.length; j++) {
    try {
      GmailApp.sendEmail(emails[j], subject, body + footer, {
        name: 'Bridge & Bow Travel'
      });
      sentCount++;
    } catch (err) {
      failedCount++;
      Logger.log('Failed to send to ' + emails[j] + ': ' + err.toString());
    }
  }

  // Reset the ready-to-send checkbox and log when this went out, so the
  // same content can never accidentally be sent twice.
  emailSheet.getRange('B3').setValue(false);
  emailSheet.getRange('B4').setValue(new Date());

  // Confirmation email to you so you know it actually went out
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: 'Weekly deal email sent — ' + sentCount + ' delivered, ' + failedCount + ' failed',
    body: 'Subject: ' + subject + '\nSent to: ' + sentCount + ' subscribers\nFailed: ' + failedCount
  });
}

/**
 * Manual test — run this directly from the editor to send immediately,
 * bypassing the weekly trigger, useful for testing before relying on
 * the scheduled version.
 */
function testWeeklyDealEmail() {
  sendWeeklyDealEmail();
}

