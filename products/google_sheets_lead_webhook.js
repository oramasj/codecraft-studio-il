/**
 * ⚡ Google Apps Script: Webhook אוטומטי ללכידת לידים ב-Google Sheets + התראת מייל מיידית
 * עלות חודשית: 0 ₪ (מחליף מנוי Zapier או Make שעולה 20$ לחודש)
 * 
 * הוראות התקנה ב-60 שניות:
 * 1. פתח גיליון Google Sheets חדש.
 * 2. לחץ בתפריט על: Extensions (הרחבות) -> Apps Script.
 * 3. מחק את כל מה שמופיע שם והדבק את הקוד הזה.
 * 4. עדכן את המייל שלך בשורה 12 (ALERT_EMAIL).
 * 5. לחץ על Deploy (פריסה) -> New deployment -> בחר Web app -> גישה: Anyone (כולם).
 * 6. העתק את ה-URL שנוצר והגדר אותו כ-Webhook בטופס האתר (אלמנטור, וורדפרס, וכו').
 */

const ALERT_EMAIL = "your-email@example.com"; // החלף במייל שלך לקבלת התראות
const SHEET_NAME = "לידים נכנסים";

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    // אם הגיליון לא קיים עדיין, צור אותו עם כותרות מסודרות
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["תאריך ושעה", "שם מלא", "טלפון", "אימייל", "הודעה / הערות", "מקור"]);
      sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#f1f5f9");
      sheet.setFrozenRows(1);
    }
    
    // פענוח הנתונים שהגיעו (תומך ב-JSON וב-Form URL Encoded)
    let data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter;
      }
    } else {
      data = e.parameter || {};
    }
    
    const now = new Date();
    const timestamp = Utilities.formatDate(now, "Asia/Jerusalem", "dd/MM/yyyy HH:mm:ss");
    const name = data.name || data.fullName || data["שם"] || "לא צוין";
    const phone = data.phone || data.tel || data["טלפון"] || "לא צוין";
    const email = data.email || data.mail || data["אימייל"] || "לא צוין";
    const message = data.message || data.notes || data["הודעה"] || "";
    const source = data.source || data.referrer || "טופס אתר";
    
    // הוספת השורה לגיליון
    sheet.appendRow([timestamp, name, phone, email, message, source]);
    
    // שליחת התראת מייל מיידית לבעל העסק
    if (ALERT_EMAIL && ALERT_EMAIL !== "your-email@example.com") {
      const subject = `🔥 ליד חדש נכנס מהאתר: ${name} (${phone})`;
      const body = `שלום,\n\nהתקבל ליד חדש באתר שלך:\n\n• שם: ${name}\n• טלפון: ${phone}\n• אימייל: ${email}\n• הודעה: ${message}\n• תאריך: ${timestamp}\n\nהליד נשמר אוטומטית בגיליון Google Sheets שלך.`;
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Lead saved successfully",
      timestamp: timestamp
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput("QuoteCraft Lead Webhook Engine is Running (200 OK)");
}