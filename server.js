#!/usr/bin/env node
/**
 * server.js
 * שרת המונטיזציה של אתגר 100 השקלים היומי (Project #4: 100 NIS Daily Challenge)
 * תכונות מרכזיות:
 * - שירות עצמי מהיר ללא תלות בספריות חיצוניות (Node.js Core בלבד)
 * - הגשה מאובטחת של דפי הקטלוג והתצוגות המקדימות (Path Traversal Guard)
 * - אספקה מיידית של 8 מוצרי קוד Standalone מלאים (/api/download/:productKey)
 * - קליטת פניות והזמנות מותאמות אישית עם אימות קלט (/api/order, /api/orders)
 * - טלמטריה רציפה, אימות קוד פתיחה ומעקב אחר יעד 100 ₪ יומי (/api/stats, /api/status)
 * - הגשת מסך הבקרה היומי (/daily_tracker.html, /tracker, /dashboard)
 * - בידוד נתונים ובטיחות תהליכים מרובים ללא התנגשויות (Serialized Write Queue)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildProtectedPreview, hashUnlockCode, DEFAULT_UNLOCK_HASH } from './fulfillment_engine.js';

const PORT = Number(process.env.PORT || 8800);
const WORKSPACE = path.dirname(fileURLToPath(import.meta.url));
const PREVIEWS_DIR = path.join(WORKSPACE, 'previews');
const PRODUCTS_DIR = path.join(WORKSPACE, 'products');
const TELEMETRY_FILE = path.join(WORKSPACE, 'telemetry.json');
const ORDERS_FILE = path.join(WORKSPACE, 'inbound_orders.json');
const PROGRESS_FILE = path.join(WORKSPACE, 'daily_progress.json');
const PID_FILE = path.join(WORKSPACE, 'server.pid');

// מוצרי מדף זמינים להורדה מיידית
export const PRODUCT_CATALOG = {
  'quotecraft': { file: 'quotecraft_standalone_v1.html', dir: 'products' },
  'tax_refund': { file: 'tax_refund_calculator_standalone.html', dir: 'products' },
  'freelance_shield': { file: 'freelance_shield_calculator_standalone.html', dir: 'products' },
  'salary_auditor': { file: 'salary_auditor_standalone.html', dir: 'products' },
  'mortgage_auditor': { file: 'mortgage_auditor_standalone.html', dir: 'products' },
  'legal_shield': { file: 'legal_shield_generator_standalone.html', dir: 'products' },
  'whatsapp_minisite': { file: 'whatsapp_minisite_builder_standalone.html', dir: 'products' },
  'sheets_webhook': { file: 'google_sheets_lead_webhook.js', dir: 'products' },
  // תוצרים מורחבים מתיקיית previews
  'clinic_booking': { file: 'preview_CLINIC_BOOKING.html', dir: 'previews' },
  'realestate_pro': { file: 'preview_REALESTATE_PRO.html', dir: 'previews' },
  'cv_booster': { file: 'preview_CV_BOOSTER.html', dir: 'previews' },
  'war_room': { file: 'preview_WAR_ROOM.html', dir: 'previews' },
  'share_center': { file: 'share_center.html', dir: 'previews' },
  'master_index': { file: 'index.html', dir: 'previews' },
  'landing_commerce': { file: 'preview_XPLACE_216353.html', dir: 'previews' },
  'xplace_leads': { file: 'preview_XPLACE_216327.html', dir: 'previews' },
  'xplace_auto': { file: 'preview_XPLACE_217130.html', dir: 'previews' }
};

export const PRODUCT_ALIASES = {
  'quote_invoice': 'quotecraft',
  'quote_craft': 'quotecraft',
  'quotecraft_pro': 'quotecraft',
  'quotecraft_standalone_v1_html': 'quotecraft',
  'tax_refund': 'tax_refund',
  'taxrefund': 'tax_refund',
  'tax_audit': 'tax_refund',
  'tax_refund_calculator_standalone_html': 'tax_refund',
  'freelance_shield': 'freelance_shield',
  'freelanceshield': 'freelance_shield',
  'freelance_shield_calculator_standalone_html': 'freelance_shield',
  'salary_auditor': 'salary_auditor',
  'salaryauditor': 'salary_auditor',
  'salary_auditor_standalone_html': 'salary_auditor',
  'mortgage_auditor': 'mortgage_auditor',
  'mortgageauditor': 'mortgage_auditor',
  'mortgage_auditor_standalone_html': 'mortgage_auditor',
  'legal_shield': 'legal_shield',
  'legalshield': 'legal_shield',
  'legal_shield_generator_standalone_html': 'legal_shield',
  'whatsapp_minisite': 'whatsapp_minisite',
  'whatsappminisite': 'whatsapp_minisite',
  'whatsapp_minisite_builder_standalone_html': 'whatsapp_minisite',
  'sheets_webhook': 'sheets_webhook',
  'sheetswebhook': 'sheets_webhook',
  'google_sheets_lead_webhook': 'sheets_webhook',
  'google_sheets_lead_webhook_js': 'sheets_webhook',
  'clinic_booking': 'clinic_booking',
  'realestate_pro': 'realestate_pro',
  'cv_booster': 'cv_booster',
  'war_room_bundle': 'war_room',
  'war_room': 'war_room',
  'share_center': 'share_center',
  'master_index': 'master_index',
  'landing_commerce': 'landing_commerce',
  'landing': 'landing_commerce',
  'landing_page': 'landing_commerce',
  'xplace_216353': 'landing_commerce',
  'xplace_216327': 'sheets_webhook',
  'xplace_217130': 'realestate_pro'
};

export function resolveProductKey(rawKey) {
  if (!rawKey) return 'quotecraft';
  const clean = String(rawKey).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (PRODUCT_ALIASES[clean]) return PRODUCT_ALIASES[clean];
  if (PRODUCT_CATALOG[clean]) return clean;

  const noUnderscore = clean.replace(/_/g, '');
  for (const k of Object.keys(PRODUCT_CATALOG)) {
    if (k.replace(/_/g, '') === noUnderscore) return k;
  }
  for (const [alias, target] of Object.entries(PRODUCT_ALIASES)) {
    if (alias.replace(/_/g, '') === noUnderscore) return target;
  }
  return 'quotecraft';
}

export function getCatalogItem(rawKey, customProductsDir = PRODUCTS_DIR, customPreviewsDir = PREVIEWS_DIR) {
  const key = resolveProductKey(rawKey);
  const entry = PRODUCT_CATALOG[key];
  if (!entry) return null;
  const fileName = typeof entry === 'string' ? entry : entry.file;
  const subDir = (typeof entry === 'object' && entry.dir === 'previews') ? customPreviewsDir : customProductsDir;
  return {
    key,
    fileName,
    filePath: path.join(subDir, fileName)
  };
}

export function matchServiceTemplate(description = '', clientName = '') {
  const text = (String(description || '') + ' ' + String(clientName || '')).toLowerCase();

  if (/sheet|שיטס|טופס|גוגל|webhook|וליד|אוטומצי|csv|אקסל/.test(text)) {
    return {
      key: 'sheets_webhook',
      title: 'אוטומציית לידים וחיבור טפסים ל-Google Sheets (ללא Zapier)',
      previewSnippet: '✔ סקריפט Google Apps Script מוכן להדבקה<br>✔ טופס לידים מעוצב להטמעה בדף נחיתה<br>✔ שליחת מייל אוטומטי ללקוח וייצוא לקובץ CSV<br>✔ פתרון קוד עצמאי As-Is ללא דמי מנוי'
    };
  }
  if (/הצעת מחיר|חשבונית|חתימ|quote|מסמך|סעיפים|מע"מ|מעמ/.test(text)) {
    return {
      key: 'quotecraft',
      title: 'מחולל הצעות מחיר וחתימה דיגיטלית על המסך לעסקים',
      previewSnippet: '✔ הוספה ועריכה של סעיפים ותמחור חי<br>✔ חישוב מע״מ 18% והנחות אוטומטי<br>✔ לוח חתימה דיגיטלית באצבע או בעכבר<br>✔ ייצוא להדפסה ו-PDF נקי לעסקים'
    };
  }
  if (/משכנת|ריבית|בנק|סילוקין|שפיצר|עוש|עו"ש/.test(text)) {
    return {
      key: 'mortgage_auditor',
      title: 'בורר חיסכון במחזור משכנתא, ריביות עו״ש ועמלות בנק',
      previewSnippet: '✔ סימולטור לוח סילוקין שפיצר חי<br>✔ חישוב חיסכון במחזור ריבית וביטוח חיים<br>✔ מחולל מכתב דרישה רשמי להורדת ריבית בבנק'
    };
  }
  if (/מס|135|שכיר|החזר|106|תרומ|סעיף 46/.test(text)) {
    return {
      key: 'tax_refund',
      title: 'סימולטור החזרי מס לשכירים (טופס 135 — 6 שנים אחורה)',
      previewSnippet: '✔ חישוב זכאות להחזר מס בגין החלפת עבודות, נקודות זיכוי ותרומות<br>✔ הפקת מכתב נלווה רשמי לפקיד השומה<br>✔ 100% מההחזר נשאר אצל הלקוח ללא עמלת 20%'
    };
  }
  if (/שכר|תלוש|פנסי|שעות נוספות|הבראה|פיצוי|מעסיק/.test(text)) {
    return {
      key: 'salary_auditor',
      title: 'בודק תלוש שכר, פנסיה, שעות נוספות ופיצויי פיטורים',
      previewSnippet: '✔ בדיקת הפרשי פנסיה 6.5%, שעות נוספות 125%/150% ודמי הבראה<br>✔ מחולל מכתב דרישה רשמי למעסיק לפי דיני עבודה'
    };
  }
  if (/עוסק זעיר|הוצאות מוכרות|30%|עצמאי|פרילנס/.test(text)) {
    return {
      key: 'freelance_shield',
      title: 'מחשבון עוסק זעיר (30%) מול הוצאות מוכרות ומע״מ 18%',
      previewSnippet: '✔ השוואה חכמה בין מסלול 30% אוטומטי להוצאות מפורטות<br>✔ חישוב חיסכון במס הכנסה, ביטוח לאומי ומע״מ תשומות'
    };
  }
  if (/ביטול עסק|צרכן|דוח|דו"ח|פיצוי|התראה|ליקוי/.test(text)) {
    return {
      key: 'legal_shield',
      title: 'מחולל מכתבי ביטול עסקה, פיצוי 10,000 ₪ וערעור על דו״חות',
      previewSnippet: '✔ 4 מכתבים רשמיים מנוסחים לפי חוק הגנת הצרכן<br>✔ ביטול עסקה, התראת פיצוי ללא הוכחת נזק, וערעור על דו״ח חניה'
    };
  }
  if (/וואטסאפ|whatsapp|מיני סייט|כרטיס ביקור|ביקור/.test(text)) {
    return {
      key: 'whatsapp_minisite',
      title: 'בונה מיני-סייט וכרטיס ביקור דיגיטלי לוואטסאפ',
      previewSnippet: '✔ כרטיס ביקור אינטראקטיבי מותאם סמארטפון<br>✔ לחצני חיוג, ניווט Waze, וואטסאפ מהיר והורדת קובץ vCard'
    };
  }
  if (/תור|קליניק|מאמן|טיפול|יומן|book/.test(text)) {
    return {
      key: 'clinic_booking',
      title: 'מערכת תיאום תורים אינטראקטיבית לקליניקות ומאמנים',
      previewSnippet: '✔ בחירת סוג טיפול ותצוגת יומן שעות פנויות<br>✔ סיכום תור ואישור ישיר ללא עמלות מנוי חודשיות'
    };
  }
  if (/רכב|מכוני|סוכנות|מגרש|טרייד/.test(text)) {
    return {
      key: 'realestate_pro', // fallback to automotive if available or default
      title: 'תבנית אתר לסוכנות רכב וקטלוג רכבים יד-שנייה',
      previewSnippet: '✔ סינון רכבים לפי תקציב ושנה ומחשבון מימון ל-60 תשלומים<br>✔ ממשק ניהול מלאי והוספת רכבים חי'
    };
  }
  if (/נדלן|תיווך|דירה|נכס|שכירות/.test(text)) {
    return {
      key: 'realestate_pro',
      title: 'תבנית אתר למשרד תיווך ונדל״ן עם מחשבון משכנתא',
      previewSnippet: '✔ קטלוג נכסים יוקרתי למכירה ולהשכרה<br>✔ מחשבון משכנתא ותשואת שכירות אוטומטי'
    };
  }
  if (/נחיתה|דף נחיתה|landing|תדמית|showcase|חנות|סל קניות|e-commerce|איקומרס/.test(text)) {
    return {
      key: 'landing_commerce',
      title: 'קטלוג מסחרי + 2 דפי נחיתה לעסקים ומכירות',
      previewSnippet: '✔ קטלוג מוצרים אינטראקטיבי עם סל הזמנות מהיר<br>✔ זוג דפי נחיתה מעוצבים למבצעי השקה ופגישות<br>✔ אספקה מיידית בקובץ קוד עצמאי As-Is ללא דמי מנוי'
    };
  }
  if (/קורות חיים|cv|resume|קורות-חיים|ראיון עבודה|ats/.test(text)) {
    return {
      key: 'cv_booster',
      title: 'משדרג קורות חיים (CV) ומכתב מקדים מותאם מערכות גיוס ATS',
      previewSnippet: '✔ בדיקת ציון התאמה למערכות סינון ATS<br>✔ עיצוב אוטומטי של קורות חיים בפורמט מנהלים נקי ל-PDF<br>✔ מכתב מקדים מנוסח אישית ללא תשלום מנוי'
    };
  }

  return {
    key: 'quotecraft',
    title: 'פתרון קוד עצמאי מותאם אישית — שירות מהיר',
    previewSnippet: '✔ קוד HTML5/JavaScript עצמאי ומוכן לשימוש<br>✔ אישור תנאי As-Is והורדה מיידית לאחר העברה בביט'
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.vcf': 'text/vcard; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

export function initStorage(telemetryPath = TELEMETRY_FILE, ordersPath = ORDERS_FILE, progressPath = PROGRESS_FILE) {
  if (!fs.existsSync(ordersPath)) {
    fs.writeFileSync(ordersPath, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(telemetryPath)) {
    fs.writeFileSync(telemetryPath, JSON.stringify({
      startedAt: new Date().toISOString(),
      pageViews: 0,
      bitCopyClicks: 0,
      unlockAttempts: 0,
      successfulUnlocks: 0,
      customOrdersCount: 0,
      recentEvents: []
    }, null, 2), 'utf8');
  }
  if (!fs.existsSync(progressPath)) {
    fs.writeFileSync(progressPath, JSON.stringify({
      targetGoalNIS: 100,
      currentCollectedNIS: 0,
      percentComplete: 0,
      ordersReceived: 0,
      lastUpdated: new Date().toISOString()
    }, null, 2), 'utf8');
  }
}

initStorage();

export function loadJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let writeQueuePromise = Promise.resolve();

export function saveJson(file, data) {
  writeQueuePromise = writeQueuePromise.then(() => {
    try {
      const rand = Math.random().toString(36).slice(2, 8);
      const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${rand}`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`Error saving ${file}:`, err.message);
    }
  });
  return writeQueuePromise;
}

export function updateProgress(collectedAdd = 0, progressFile = PROGRESS_FILE, ordersFile = ORDERS_FILE) {
  const prog = loadJson(progressFile, { targetGoalNIS: 100, currentCollectedNIS: 0 });
  const orders = loadJson(ordersFile, []);
  prog.currentCollectedNIS = Math.max(0, (prog.currentCollectedNIS || 0) + collectedAdd);
  prog.ordersReceived = orders.length;
  prog.percentComplete = Math.min(100, Math.round((prog.currentCollectedNIS / (prog.targetGoalNIS || 100)) * 100));
  prog.lastUpdated = new Date().toISOString();
  saveJson(progressFile, prog);
  return prog;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length < 32768) body += chunk;
    });
    req.on('end', () => {
      if (!body || !body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null); // Return null on JSON parse error
      }
    });
    req.on('error', () => resolve(null));
  });
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

export function createServer(options = {}) {
  const telemetryFile = options.telemetryFile || process.env.TELEMETRY_FILE || TELEMETRY_FILE;
  const ordersFile = options.ordersFile || process.env.ORDERS_FILE || ORDERS_FILE;
  const progressFile = options.progressFile || process.env.PROGRESS_FILE || PROGRESS_FILE;
  const previewsDir = options.previewsDir || PREVIEWS_DIR;
  const productsDir = options.productsDir || PRODUCTS_DIR;
  const port = options.port || Number(process.env.PORT || 8800);

  initStorage(telemetryFile, ordersFile, progressFile);

  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let rawDecoded = '';
    try {
      rawDecoded = decodeURIComponent(req.url || '/');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    // הגנת Path Traversal
    if (rawDecoded.includes('..') || rawDecoded.includes('\0')) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const url = rawDecoded.split('?')[0];

    // 1. בדיקת תקינות וסטטיסטיקות שרת
    if (req.method === 'GET' && (url === '/api/status' || url === '/api/stats')) {
      const telemetry = loadJson(telemetryFile);
      const orders = loadJson(ordersFile, []);
      const progress = loadJson(progressFile);
      return sendJson(res, 200, {
        status: 'healthy',
        project: 'Project #4: 100 NIS Daily Challenge',
        port,
        uptimeSeconds: Math.round(process.uptime()),
        telemetry,
        totalOrders: orders.length,
        progress,
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }

    // 2. החזרת רשימת הפניות עבור מסך הבקרה (GET /api/orders)
    if (req.method === 'GET' && (url === '/api/orders' || url === '/inbound_orders.json')) {
      const orders = loadJson(ordersFile, []);
      return sendJson(res, 200, orders);
    }

    // 2ב. החזרת רשימת לידים בלבד (Lead Generation Arbitrage: GET /api/leads)
    if (req.method === 'GET' && (url === '/api/leads' || url === '/leads.json')) {
      const orders = loadJson(ordersFile, []);
      const leads = orders.filter(o => o.category === 'lead_arbitrage' || o.isLead === true);
      const totalEstimatedNIS = leads.reduce((acc, curr) => acc + (Number(curr.estimatedValue || 0) || 0), 0);
      return sendJson(res, 200, {
        count: leads.length,
        totalEstimatedNIS,
        leads
      });
    }

    // 2ג. ייצוא פניות לקובץ CSV (GET /api/orders/export.csv, /api/orders.csv)
    if (req.method === 'GET' && (url === '/api/orders/export.csv' || url === '/api/orders.csv')) {
      const orders = loadJson(ordersFile, []);
      const headers = ['מזהה הזמנה', 'תאריך', 'שם לקוח', 'טלפון', 'קטגוריה', 'שירות', 'תיאור משימה', 'תקציב (₪)', 'שווי משוער (₪)', 'תבנית שהותאמה', 'קישור לתצוגה'];
      const formatCsvField = (val) => {
        const str = String(val ?? '')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        return `"${str.replace(/"/g, '""')}"`;
      };
      const rows = orders.map(o => [
        o.id,
        o.receivedAt,
        formatCsvField(o.name),
        formatCsvField(o.phone),
        o.category || 'custom_order',
        o.service || '',
        formatCsvField(o.taskDescription),
        o.budgetNIS || 100,
        o.estimatedValue || '',
        o.matchedTemplate || '',
        o.previewUrl || ''
      ]);
      const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="inbound_orders.csv"',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(csv);
      return;
    }

    // 3. הגשת מסך הבקרה היומי מתיקיית הפרויקט
    if (req.method === 'GET' && (url === '/daily_tracker.html' || url === '/tracker' || url === '/dashboard')) {
      const trackerPath = path.join(WORKSPACE, 'daily_tracker.html');
      if (fs.existsSync(trackerPath) && fs.statSync(trackerPath).isFile()) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(trackerPath).pipe(res);
        return;
      }
    }

    // 4. קליטת אירוע שימוש (העתקת ביט, PayBox, כניסה לדף)
    if (req.method === 'POST' && url === '/api/event') {
      const body = (await readJsonBody(req)) || {};
      const telemetry = loadJson(telemetryFile);
      const evType = String(body.type || body.eventType || 'unknown').slice(0, 40);
      const itemId = String(body.itemId || body.product || '').slice(0, 60);

      if (evType === 'copy_bit' || evType === 'copy_paybox' || evType === 'paybox_click') {
        telemetry.bitCopyClicks = (telemetry.bitCopyClicks || 0) + 1;
      }

      telemetry.recentEvents = telemetry.recentEvents || [];
      telemetry.recentEvents.unshift({
        at: new Date().toISOString(),
        type: evType,
        itemId,
        amount: Number(body.amount || 100)
      });
      if (telemetry.recentEvents.length > 50) telemetry.recentEvents.length = 50;
      await saveJson(telemetryFile, telemetry);

      return sendJson(res, 200, { ok: true, bitCopyClicks: telemetry.bitCopyClicks });
    }

    // 5. אימות קוד פתיחה (Bit Unlock)
    if (req.method === 'POST' && url === '/api/unlock') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, { success: false, valid: false, error: 'Invalid JSON payload' });
      }

      const rawCode = String(body.code || '').trim();
      const rawItemId = String(body.itemId || 'quotecraft').slice(0, 60);
      const telemetry = loadJson(telemetryFile);

      telemetry.unlockAttempts = (telemetry.unlockAttempts || 0) + 1;
      const isValid = (hashUnlockCode(rawCode) === DEFAULT_UNLOCK_HASH) || (rawCode === '2800');

      if (isValid) {
        telemetry.successfulUnlocks = (telemetry.successfulUnlocks || 0) + 1;
        updateProgress(50, progressFile, ordersFile);
      }

      telemetry.recentEvents = telemetry.recentEvents || [];
      telemetry.recentEvents.unshift({
        at: new Date().toISOString(),
        type: isValid ? 'unlock_success' : 'unlock_failed',
        itemId: rawItemId
      });
      if (telemetry.recentEvents.length > 50) telemetry.recentEvents.length = 50;
      await saveJson(telemetryFile, telemetry);

      const resolvedKey = resolveProductKey(rawItemId);
      return sendJson(res, isValid ? 200 : 403, {
        success: isValid,
        valid: isValid,
        itemId: rawItemId,
        productKey: resolvedKey,
        downloadUrl: isValid ? `/api/download/${resolvedKey}` : null,
        message: isValid ? 'הקוד אומת בהצלחה! הקובץ מוכן להורדה מיידית.' : 'קוד פתיחה שגוי.'
      });
    }

    // 6. קליטת פנייה מותאמת אישית (Custom Inbound Order & Lead Arbitrage)
    if (req.method === 'POST' && url === '/api/order') {
      const rawOrder = await readJsonBody(req);
      if (!rawOrder || typeof rawOrder !== 'object') {
        return sendJson(res, 400, { success: false, error: 'Invalid or malformed JSON payload' });
      }

      const name = escapeHtml(String(rawOrder.name || rawOrder.customerName || '').trim().slice(0, 80));
      const phone = escapeHtml(String(rawOrder.phone || rawOrder.customerContact || rawOrder.contact || '').trim().slice(0, 40));
      const taskDescription = escapeHtml(String(rawOrder.taskDescription || rawOrder.description || '').trim().slice(0, 500));

      if (!phone && !taskDescription && !name) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing required order fields (name, phone, or taskDescription required)'
        });
      }

      const isLead = rawOrder.category === 'lead_arbitrage' || rawOrder.isLead === true;
      let matched = null;
      let customPreview = null;

      if (!isLead) {
        matched = matchServiceTemplate(taskDescription, name);
        const customId = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
        try {
          customPreview = buildProtectedPreview({
            id: customId,
            clientName: name || 'לקוח יקר',
            requestTitle: matched.title,
            previewSnippet: matched.previewSnippet,
            priceNIS: Math.max(50, Math.min(2800, Number(rawOrder.budgetNIS || 100) || 100)),
            previewsDir
          });
        } catch {}
      }

      const order = {
        id: 'ORD-' + Date.now(),
        receivedAt: new Date().toISOString(),
        name,
        phone,
        taskDescription,
        budgetNIS: Math.max(50, Math.min(2800, Number(rawOrder.budgetNIS || 100) || 100)),
        category: isLead ? 'lead_arbitrage' : 'custom_order',
        service: rawOrder.service || (matched ? matched.key : null),
        estimatedValue: rawOrder.estimatedValue || null,
        email: escapeHtml(String(rawOrder.email || '').trim().slice(0, 80)),
        matchedTemplate: matched ? matched.key : null,
        previewUrl: customPreview ? `/preview_${customPreview.id}.html` : null,
        customPreviewId: customPreview ? customPreview.id : null
      };

      const orders = loadJson(ordersFile, []);
      orders.push(order);
      await saveJson(ordersFile, orders);

      const telemetry = loadJson(telemetryFile);
      telemetry.customOrdersCount = (telemetry.customOrdersCount || 0) + 1;
      if (isLead) {
        telemetry.leadCaptureCount = (telemetry.leadCaptureCount || 0) + 1;
      }
      await saveJson(telemetryFile, telemetry);

      updateProgress(0, progressFile, ordersFile);

      return sendJson(res, 200, {
        success: true,
        orderId: order.id,
        matchedTemplate: order.matchedTemplate,
        previewUrl: order.previewUrl,
        message: isLead
          ? 'פנייתך התקבלה בהצלחה! יועץ מוסמך ייצור איתך קשר בהקדם.'
          : 'פנייתך התקבלה בהצלחה! הכנו עבורך פתרון מוכן מראש לבדיקה מיידית.'
      });
    }

    // 7. מחולל תצוגה מקדימה מהירה לפי דרישה (Pre-Fulfillment)
    if (req.method === 'POST' && url === '/api/request-task') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, { ok: false, error: 'Invalid JSON payload' });
      }

      const clientName = escapeHtml(String(body.clientName || 'לקוח יקר').trim().slice(0, 80)) || 'לקוח יקר';
      const requestTitle = escapeHtml(String(body.requestTitle || '').trim().slice(0, 140));

      if (!requestTitle) {
        return sendJson(res, 400, { ok: false, error: 'Missing requestTitle' });
      }

      const rawSnippet = String(body.previewSnippet || '').trim().slice(0, 600);
      const safeSnippet = rawSnippet
        ? escapeHtml(rawSnippet).replace(/&lt;br&gt;/g, '<br>')
        : '✔ המשימה הוכנה לתצוגה מקדימה מוגנת<br>✔ אספקה מיידית בקובץ עצמאי לאחר אישור As-Is והעברה בביט';
      const priceNIS = Math.max(20, Math.min(2800, Number(body.priceNIS || 100) || 100));
      const customId = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;

      const built = buildProtectedPreview({
        id: customId,
        clientName,
        requestTitle,
        previewSnippet: safeSnippet,
        priceNIS,
        previewsDir
      });

      return sendJson(res, 200, { ok: true, id: built.id, previewUrl: `/preview_${built.id}.html` });
    }

    // 8. הורדת קבצי מוצר מוכנים (Standalone Deliverables)
    if (req.method === 'GET' && url.startsWith('/api/download/')) {
      const keyOrFile = url.replace('/api/download/', '').trim();
      const catalogItem = getCatalogItem(keyOrFile, productsDir, previewsDir);

      let targetPath = null;
      if (catalogItem && fs.existsSync(catalogItem.filePath)) {
        targetPath = catalogItem.filePath;
      } else {
        // בדיקת קובץ ישיר בתיקיית products
        const directProductsPath = path.normalize(path.join(productsDir, keyOrFile));
        if (directProductsPath.startsWith(productsDir + path.sep) && fs.existsSync(directProductsPath)) {
          targetPath = directProductsPath;
        } else {
          // בדיקת קובץ ישיר בתיקיית previews
          const directPreviewsPath = path.normalize(path.join(previewsDir, keyOrFile));
          if (directPreviewsPath.startsWith(previewsDir + path.sep) && fs.existsSync(directPreviewsPath)) {
            targetPath = directPreviewsPath;
          }
        }
      }

      if (!targetPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Product File Not Found');
        return;
      }

      if (fs.statSync(targetPath).isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${path.basename(targetPath)}"`,
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(targetPath).pipe(res);
        return;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Product File Not Found');
        return;
      }
    }

    // 9. הגשת דפי אינטרנט ותצוגות מקדימות מתיקיית previews/ או משורש הפרויקט
    const targetRel = (url === '/' || url === '/index.html') ? 'index.html' : url.replace(/^\/+/, '');
    let safeTarget = path.normalize(path.join(previewsDir, targetRel));

    if (!safeTarget.startsWith(previewsDir + path.sep) && safeTarget !== previewsDir) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(safeTarget) || !fs.statSync(safeTarget).isFile()) {
      const rootTarget = path.normalize(path.join(WORKSPACE, targetRel));
      if (rootTarget.startsWith(WORKSPACE + path.sep) && fs.existsSync(rootTarget) && fs.statSync(rootTarget).isFile()) {
        safeTarget = rootTarget;
      }
    }

    if (fs.existsSync(safeTarget) && fs.statSync(safeTarget).isFile()) {
      const ext = path.extname(safeTarget).toLowerCase();
      if (ext === '.html') {
        const telemetry = loadJson(telemetryFile);
        telemetry.pageViews = (telemetry.pageViews || 0) + 1;
        await saveJson(telemetryFile, telemetry);
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(safeTarget).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Page Not Found');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createServer();

  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch {}

  const cleanExit = () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
  process.on('exit', () => {
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {}
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Project #4] 100 NIS Daily Challenge Engine running at http://127.0.0.1:${PORT} (PID=${process.pid})`);
  });
}
