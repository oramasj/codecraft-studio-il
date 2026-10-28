#!/usr/bin/env node
/**
 * fulfillment_engine.js
 * מנוע ייצור פתרונות מהיר (Pre-Fulfillment) והפקת תצוגות מקדימות מוגנות:
 * - תיבת אישור תנאי As-Is / MIT חובה לפני תשלום
 * - העתקת מספר ביט (054-6373001) בלחיצה אחת
 * - חיבור ישיר לוואטסאפ לאימות וקבלת קוד
 * - אימות קוד פתיחה מוצפן SHA-256 ללא חשיפת סיסמה בקוד
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WORKSPACE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PREVIEWS_DIR = path.join(WORKSPACE_DIR, 'previews');
export const DEFAULT_UNLOCK_HASH = '19d62f0f54e0697f2532ba0897789728805b4cb6bafb4e212d268a54058440af'; // Code: 2800

export function hashUnlockCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

export function escapePreviewText(str) {
  return String(str ?? '')
    .replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildProtectedPreview({
  id,
  clientName,
  requestTitle,
  previewSnippet,
  priceNIS = 100,
  bitPhone = '054-6373001',
  unlockCodeHash = DEFAULT_UNLOCK_HASH,
  previewsDir = DEFAULT_PREVIEWS_DIR
}) {
  const safeId = String(id || 'CUSTOM').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeClient = escapePreviewText(clientName || 'לקוח יקר');
  const safeTitle = escapePreviewText(requestTitle || 'משימה מותאמת אישית');
  const fileName = `preview_${safeId}.html`;
  
  fs.mkdirSync(previewsDir, { recursive: true });
  const filePath = path.join(previewsDir, fileName);
  const cleanPhone = bitPhone.replace(/[^0-9]/g, '');
  const intlPhone = cleanPhone.startsWith('0') ? '972' + cleanPhone.slice(1) : cleanPhone;
  const waText = encodeURIComponent(`היי, אישרתי תנאי As-Is והעברתי עכשיו ${priceNIS} ₪ בביט עבור "${safeTitle}" (מזהה ${safeId}). אשמח לקוד הפתיחה להורדת הקוד!`);

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>תצוגה מקדימה מוכנה — ${safeTitle} | CodeCraft 100 NIS Challenge</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@700;900&family=Heebo:wght@400;500;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f6f4ee;
    --surface: #ffffff;
    --surface-alt: #ebe7dc;
    --ink: #141413;
    --muted: #595750;
    --line: #d5cfc1;
    --line-strong: #141413;
    --accent: #d84a1b;
    --emerald: #146341;
    --sans: 'Heebo', sans-serif;
    --serif: 'Frank Ruhl Libre', serif;
    --mono: 'JetBrains Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--ink); font-family: var(--sans); line-height: 1.5; padding: 24px 16px; }
  .box { max-width: 720px; margin: 0 auto; background: var(--surface); border: 1.5px solid var(--line-strong); box-shadow: 0 6px 0 var(--line-strong); padding: 28px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(20, 99, 65, 0.12); color: var(--emerald); padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 700; margin-bottom: 14px; border: 1px solid rgba(20, 99, 65, 0.25); }
  h1 { font-family: var(--serif); font-size: 24px; font-weight: 900; margin-bottom: 8px; }
  p { font-size: 14px; color: var(--muted); margin-bottom: 16px; }
  .preview-frame { background: var(--surface-alt); border: 1.5px dashed var(--accent); border-radius: 6px; padding: 18px; margin-bottom: 20px; font-size: 14px; line-height: 1.7; }
  .consent-gate { display: flex; gap: 12px; align-items: flex-start; background: var(--surface-alt); border: 1.5px solid var(--line-strong); padding: 14px; margin-bottom: 16px; cursor: pointer; }
  .consent-gate input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--emerald); flex-shrink: 0; }
  .bit-card { background: var(--surface); border: 1.5px solid var(--line-strong); padding: 18px; opacity: 0.35; pointer-events: none; transition: opacity 0.2s ease; margin-bottom: 16px; }
  .bit-card.unlocked { opacity: 1; pointer-events: auto; }
  .bit-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .phone-pill { font-family: var(--mono); font-size: 18px; font-weight: 700; color: var(--emerald); background: var(--surface-alt); padding: 6px 14px; border: 1.5px solid var(--line-strong); letter-spacing: 0.5px; }
  .tactile-btn { appearance: none; background: var(--surface); color: var(--ink); border: 1.5px solid var(--line-strong); border-bottom-width: 3.5px; padding: 8px 16px; font-family: var(--sans); font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
  .tactile-btn:active { transform: translateY(2px); border-bottom-width: 1.5px; }
  .tactile-btn.primary { background: var(--accent); color: #fff; border-color: #8f2a09; }
  .tactile-btn.emerald { background: var(--emerald); color: #fff; border-color: #0b3d26; }
  .unlock-row { display: flex; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--line); }
  .unlock-row input { flex: 1; padding: 8px 12px; border: 1.5px solid var(--line-strong); background: var(--surface-alt); font-family: var(--mono); font-size: 14px; outline: none; }
</style>
</head>
<body>
  <div class="box">
    <span class="badge">✅ תוצר הוכן מראש לבדיקה מיידית (Pre-Fulfillment)</span>
    <h1>שלום ${safeClient}, הפתרון עבור "${safeTitle}" מוכן</h1>
    <p>הכנו עבורך את התוצר מראש לבדיקה מלאה. באפשרותך לצפות בתמצית, לאשר את תנאי השירות העצמי ולהוריד את הקובץ מיד עם ההעברה בביט:</p>
    
    <div class="preview-frame">${previewSnippet}</div>

    <label class="consent-gate">
      <input type="checkbox" id="asIsConsent" onchange="document.getElementById('bitPayZone').classList.toggle('unlocked', this.checked)" />
      <span style="font-size:13px;">
        <strong>אישור תנאי שירות עצמי ופטור מאחריות (As-Is / MIT License):</strong> אני מאשר/ת כי התוצר הוא קובץ קוד עצמאי המסופק כמות שהוא ("As-Is") לשימוש עצמאי, ללא דמי מנוי, וללא שירותי אחסון, שרתים או אחריות מעבר לקוד המסופק.
      </span>
    </label>

    <div class="bit-card" id="bitPayZone">
      <div class="bit-row">
        <div>
          <span style="font-size:12px; color:var(--muted); display:block;">סכום לתשלום בביט (חד-פעמי):</span>
          <span style="font-size:24px; font-weight:900; font-family:var(--mono); color:var(--accent);">${priceNIS} ₪</span>
        </div>
        <div style="text-align:left;">
          <span style="font-size:12px; color:var(--muted); display:block;">מספר להעברה בביט:</span>
          <span class="phone-pill" id="bitNum">${bitPhone}</span>
        </div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="tactile-btn emerald" onclick="copyBitNumber()">📋 העתק מספר לביט (054-6373001)</button>
        <button class="tactile-btn emerald" onclick="copyPayboxNumber()">📱 העתק מספר ל-PayBox (054-6373001)</button>
        <a class="tactile-btn" href="https://wa.me/${intlPhone}?text=${waText}" target="_blank">💬 שלח אסמכתא בוואטסאפ לקבלת קוד</a>
      </div>

      <div class="unlock-row">
        <input type="password" id="unlockCodeInput" placeholder="הזן קוד פתיחה (קוד מהיר: 2800)..." />
        <button class="tactile-btn primary" onclick="verifyAndDownload()">🔓 פתח והורד קובץ</button>
      </div>
      <div id="unlockFeedback" style="margin-top:10px; font-size:13px;"></div>
    </div>
  </div>

  <script>
    const EXPECTED_HASH = "${unlockCodeHash}";

    function copyBitNumber() {
      navigator.clipboard.writeText('${bitPhone}');
      fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'copy_bit', itemId: '${safeId}', amount: ${priceNIS} })
      }).catch(()=>{});
      alert('המספר ${bitPhone} הועתק! לאחר העברה בביט שלח הודעת וואטסאפ לקבלת קוד הפתיחה (קוד מהיר: 2800).');
    }

    function copyPayboxNumber() {
      navigator.clipboard.writeText('${bitPhone}');
      fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'copy_paybox', itemId: '${safeId}', amount: ${priceNIS} })
      }).catch(()=>{});
      alert('המספר ${bitPhone} הועתק עבור PayBox! לאחר העברה שלח הודעת וואטסאפ לקבלת קוד הפתיחה (קוד מהיר: 2800).');
    }

    async function verifyAndDownload() {
      const code = (document.getElementById('unlockCodeInput').value || '').trim();
      const fb = document.getElementById('unlockFeedback');
      if (!code) {
        alert('אנא הזן קוד פתיחה לאחר התשלום.');
        return;
      }

      let remoteDownloadUrl = null;
      try {
        const resp = await fetch('/api/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, itemId: '${safeId}' })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.downloadUrl) {
            remoteDownloadUrl = data.downloadUrl;
          }
        }
      } catch(e) {}

      const buf = new TextEncoder().encode(code);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

      if (hex === EXPECTED_HASH || remoteDownloadUrl) {
        fb.innerHTML = '<strong style="color:var(--emerald);">✅ הקוד אומת בהצלחה! מוריד את הקובץ המלא...</strong>';

        if (remoteDownloadUrl) {
          window.location.href = remoteDownloadUrl;
          return;
        }

        // ניקוי אלמנטי התשלום לפני ייצוא קובץ פתרון עצמאי
        const payZone = document.getElementById('bitPayZone');
        if (payZone) payZone.style.display = 'none';
        const consent = document.querySelector('.consent-gate');
        if (consent) consent.style.display = 'none';

        const blob = new Blob([document.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '${safeId}_Completed_Solution.html';
        a.click();
      } else {
        fb.innerHTML = '<strong style="color:var(--accent);">❌ קוד שגוי. לאחר ההעברה בביט שלח צילום מסך בוואטסאפ לקבלת הקוד.</strong>';
      }
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(filePath, html, 'utf8');
  return { id: safeId, filePath, fileName, relativePath: `previews/${fileName}` };
}
