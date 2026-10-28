/**
 * Google Sheets receiver for the Partner Management System.
 *
 * Setup: create a Google Sheet -> Extensions > Apps Script -> paste this file ->
 * Project Settings > Script properties: add SECRET = <a long random string> ->
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone) -> copy the /exec URL.
 * Then give the URL and SECRET to Netlify as GOOGLE_SCRIPT_URL and GOOGLE_SCRIPT_SECRET.
 */
var HEADERS = {
  'Partners': ['id','name','phone','email','address','profession','pan','dob','joinDate','status','followUp','remarks','createdAt','updatedAt'],
  'Business Logins': ['id','partnerId','partnerName','customer','loginDate','month','product','company','amount','term','payoutMode','commissionRate','manualOverride','autoPayout','finalPayout','status','followUp','paymentDate','notes','docLink','createdAt','updatedAt'],
  'Commission Rates': ['id','product','company','rate','effectiveFrom','effectiveTo','notes','createdAt','updatedAt']
};

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return out({ ok: false, error: 'bad secret' });
    var headers = HEADERS[body.sheet];
    if (!headers) return out({ ok: false, error: 'unknown sheet' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(body.sheet) || ss.insertSheet(body.sheet);
      if (sh.getLastRow() === 0) {
        sh.appendRow(headers);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      }
      var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];

      if (body.action === 'delete') {
        var i = ids.indexOf(body.id);
        if (i >= 0) sh.deleteRow(i + 2);
      } else {
        var rec = body.record;
        var row = headers.map(function (h) {
          var v = rec[h]; return v == null ? '' : v;
        });
        var idx = ids.indexOf(rec.id);
        if (idx >= 0) sh.getRange(idx + 2, 1, 1, headers.length).setValues([row]);
        else sh.appendRow(row);
      }
    } finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
