import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { hashUnlockCode, escapePreviewText, buildProtectedPreview, DEFAULT_UNLOCK_HASH } from '../fulfillment_engine.js';
import { createServer, resolveProductKey, PRODUCT_CATALOG } from '../server.js';

const WORKSPACE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRODUCTS_DIR = path.join(WORKSPACE, 'products');
const PREVIEWS_DIR = path.join(WORKSPACE, 'previews');

test('Verification 1: All 8 Standalone Products Exist and are Well-Formed', () => {
  const expectedProducts = [
    'quotecraft_standalone_v1.html',
    'tax_refund_calculator_standalone.html',
    'freelance_shield_calculator_standalone.html',
    'salary_auditor_standalone.html',
    'mortgage_auditor_standalone.html',
    'legal_shield_generator_standalone.html',
    'whatsapp_minisite_builder_standalone.html',
    'google_sheets_lead_webhook.js'
  ];

  for (const prod of expectedProducts) {
    const p = path.join(PRODUCTS_DIR, prod);
    assert.ok(fs.existsSync(p), `Missing product file: ${prod}`);
    const stat = fs.statSync(p);
    assert.ok(stat.size > 500, `Product file too small: ${prod} (${stat.size} bytes)`);

    if (prod.endsWith('.html')) {
      const content = fs.readFileSync(p, 'utf8');
      assert.ok(content.includes('<!DOCTYPE html>'), `${prod} must contain DOCTYPE`);
      assert.ok(content.includes('dir="rtl"'), `${prod} must be RTL`);
      assert.ok(content.includes('</html>'), `${prod} must close html tag`);
    }
  }
});

test('Verification 2: Fulfillment Engine Unit Tests & Product Key Resolution', () => {
  // Test SHA-256 code hashing
  const hash = hashUnlockCode('2800');
  assert.equal(hash, DEFAULT_UNLOCK_HASH, 'hashUnlockCode(2800) must equal DEFAULT_UNLOCK_HASH');

  // Test HTML escaping
  const escaped = escapePreviewText('<script>alert("xss")</script>');
  assert.ok(!escaped.includes('<script>'), 'HTML tags must be escaped');
  assert.ok(escaped.includes('&lt;script&gt;'), 'HTML tags must be encoded as entities');

  // Test Dynamic Preview Generation
  const testId = `TEST_${Date.now()}`;
  const built = buildProtectedPreview({
    id: testId,
    clientName: 'בדיקה אוטומטית',
    requestTitle: 'משימת בדיקה',
    previewSnippet: 'תצוגת בדיקה',
    priceNIS: 100,
    previewsDir: PREVIEWS_DIR
  });

  assert.ok(fs.existsSync(built.filePath), 'Built preview file must exist on disk');
  const previewHtml = fs.readFileSync(built.filePath, 'utf8');
  assert.ok(previewHtml.includes('054-6373001'), 'Preview must include Bit payment phone number');
  assert.ok(previewHtml.includes('asIsConsent'), 'Preview must include As-Is consent checkbox');
  assert.ok(previewHtml.includes('verifyAndDownload'), 'Preview must include unlock handler');

  // Cleanup test preview
  try { fs.unlinkSync(built.filePath); } catch {}

  // Test Key Resolution: Uppercase IDs & Aliases must resolve to correct distinct products
  assert.equal(resolveProductKey('TAX_REFUND'), 'tax_refund');
  assert.equal(resolveProductKey('tax-refund'), 'tax_refund');
  assert.equal(resolveProductKey('QUOTE_INVOICE'), 'quotecraft');
  assert.equal(resolveProductKey('MORTGAGE_AUDITOR'), 'mortgage_auditor');
  assert.equal(resolveProductKey('SALARY_AUDITOR'), 'salary_auditor');
  assert.equal(resolveProductKey('FREELANCE_SHIELD'), 'freelance_shield');
  assert.equal(resolveProductKey('LEGAL_SHIELD'), 'legal_shield');
  assert.equal(resolveProductKey('WHATSAPP_MINISITE'), 'whatsapp_minisite');
  assert.equal(resolveProductKey('SHEETS_WEBHOOK'), 'sheets_webhook');
  assert.equal(resolveProductKey('CLINIC_BOOKING'), 'clinic_booking');
  assert.equal(resolveProductKey('REALESTATE_PRO'), 'realestate_pro');
});

test('Verification 3: Server API, Security, Isolated Storage & Concurrency', async () => {
  const TEST_PORT = 8899;
  const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-100nis-test-'));
  const testTelemetry = path.join(testTmpDir, 'telemetry.json');
  const testOrders = path.join(testTmpDir, 'inbound_orders.json');
  const testProgress = path.join(testTmpDir, 'daily_progress.json');

  const server = createServer({
    port: TEST_PORT,
    telemetryFile: testTelemetry,
    ordersFile: testOrders,
    progressFile: testProgress
  });

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 1. GET /api/status
    const statusRes = await fetch(`${BASE_URL}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.status, 'healthy');
    assert.equal(statusJson.project, 'Project #4: 100 NIS Daily Challenge');
    assert.ok(Array.isArray(statusJson.availableProducts));
    assert.ok(statusJson.availableProducts.length >= 8);

    // 2. GET /daily_tracker.html & /tracker
    const trackerRes = await fetch(`${BASE_URL}/daily_tracker.html`);
    assert.equal(trackerRes.status, 200);
    const trackerHtml = await trackerRes.text();
    assert.ok(trackerHtml.includes('אתגר 100 השקלים היומי'));

    const trackerAliasRes = await fetch(`${BASE_URL}/tracker`);
    assert.equal(trackerAliasRes.status, 200);

    // 3. GET /api/orders
    const initOrdersRes = await fetch(`${BASE_URL}/api/orders`);
    assert.equal(initOrdersRes.status, 200);
    const initOrders = await initOrdersRes.json();
    assert.deepEqual(initOrders, []);

    // 4. POST /api/event
    const evRes = await fetch(`${BASE_URL}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'copy_bit', itemId: 'TEST_ITEM', amount: 50 })
    });
    assert.equal(evRes.status, 200);
    const evJson = await evRes.json();
    assert.equal(evJson.ok, true);

    // 5. POST /api/order (Valid Order)
    const ordRes = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'דוד ישראלי',
        phone: '052-1234567',
        taskDescription: 'דף נחיתה לעסק',
        budgetNIS: 100
      })
    });
    assert.equal(ordRes.status, 200);
    const ordJson = await ordRes.json();
    assert.equal(ordJson.success, true);
    assert.ok(ordJson.orderId.startsWith('ORD-'));

    // Check /api/orders returns the saved order
    const listRes = await fetch(`${BASE_URL}/api/orders`);
    const listJson = await listRes.json();
    assert.equal(listJson.length, 1);
    assert.equal(listJson[0].name, 'דוד ישראלי');

    // 6. POST /api/order Validation: Rejection of Empty and Malformed Payloads
    const emptyOrderRes = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', phone: '', taskDescription: '' })
    });
    assert.equal(emptyOrderRes.status, 400, 'Empty order must be rejected with 400 Bad Request');

    const malformedOrderRes = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{'
    });
    assert.equal(malformedOrderRes.status, 400, 'Malformed JSON must be rejected with 400 Bad Request');

    // 7. POST /api/unlock (Invalid code -> 403)
    const badUnlock = await fetch(`${BASE_URL}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wrong-passcode', itemId: 'quotecraft' })
    });
    assert.equal(badUnlock.status, 403);
    const badJson = await badUnlock.json();
    assert.equal(badJson.valid, false);

    // 8. POST /api/unlock with Uppercase and Alias IDs -> Correct Distinct downloadUrls
    const taxUnlock = await fetch(`${BASE_URL}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '2800', itemId: 'TAX_REFUND' })
    });
    assert.equal(taxUnlock.status, 200);
    const taxJson = await taxUnlock.json();
    assert.equal(taxJson.valid, true);
    assert.equal(taxJson.downloadUrl, '/api/download/tax_refund', 'TAX_REFUND must resolve to tax_refund download');

    const quoteUnlock = await fetch(`${BASE_URL}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '2800', itemId: 'QUOTE_INVOICE' })
    });
    assert.equal(quoteUnlock.status, 200);
    const quoteJson = await quoteUnlock.json();
    assert.equal(quoteJson.valid, true);
    assert.equal(quoteJson.downloadUrl, '/api/download/quotecraft', 'QUOTE_INVOICE must resolve to quotecraft download');

    const mortgageUnlock = await fetch(`${BASE_URL}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '2800', itemId: 'MORTGAGE_AUDITOR' })
    });
    assert.equal(mortgageUnlock.status, 200);
    const mortgageJson = await mortgageUnlock.json();
    assert.equal(mortgageJson.downloadUrl, '/api/download/mortgage_auditor');

    // 9. Download all 8 products + extended deliverables
    const catalogKeys = [
      'quotecraft',
      'tax_refund',
      'freelance_shield',
      'salary_auditor',
      'mortgage_auditor',
      'legal_shield',
      'whatsapp_minisite',
      'sheets_webhook',
      'clinic_booking',
      'realestate_pro'
    ];
    for (const key of catalogKeys) {
      const res = await fetch(`${BASE_URL}/api/download/${key}`);
      assert.equal(res.status, 200, `Download for key ${key} must succeed`);
      const body = await res.text();
      assert.ok(body.length > 300, `Downloaded body for key ${key} must be substantial`);
    }

    // 10. POST /api/request-task (Dynamic Pre-Fulfillment Generator)
    const taskRes = await fetch(`${BASE_URL}/api/request-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'עו״ד שלמה כהן',
        requestTitle: 'מערכת חישוב שכר טרחה',
        previewSnippet: 'תצוגה מקדימה למשרד עורכי דין',
        priceNIS: 100
      })
    });
    assert.equal(taskRes.status, 200);
    const taskJson = await taskRes.json();
    assert.equal(taskJson.ok, true);
    assert.ok(taskJson.previewUrl.startsWith('/preview_CUSTOM_'));

    // Check generated preview is accessible via HTTP
    const genPreviewRes = await fetch(`${BASE_URL}${taskJson.previewUrl}`);
    assert.equal(genPreviewRes.status, 200);
    const genHtml = await genPreviewRes.text();
    assert.ok(genHtml.includes('עו״ד שלמה כהן'));
    assert.ok(genHtml.includes('054-6373001'));

    // Missing title -> 400
    const badTaskRes = await fetch(`${BASE_URL}/api/request-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'עו״ד' })
    });
    assert.equal(badTaskRes.status, 400);

    // 11. Concurrency Stress Test: 8 concurrent order submissions
    const concurrentOrders = Array.from({ length: 8 }, (_, i) => ({
      name: `לקוח במקביל ${i + 1}`,
      phone: `050-000000${i}`,
      taskDescription: `משימה מרובת תהליכים ${i + 1}`,
      budgetNIS: 100 + i * 10
    }));

    const responses = await Promise.all(
      concurrentOrders.map(payload =>
        fetch(`${BASE_URL}/api/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      )
    );

    for (const r of responses) {
      assert.equal(r.status, 200, 'Concurrent order submission must succeed');
    }

    // Wait a tick for serialized write queue to finish
    await new Promise((r) => setTimeout(r, 100));
    const finalOrdersRes = await fetch(`${BASE_URL}/api/orders`);
    const finalOrders = await finalOrdersRes.json();
    // 1 initial order + 8 concurrent orders = 9 total orders
    assert.equal(finalOrders.length, 9, 'All 8 concurrent orders must be preserved without write collisions');

    // 12. Security: Path Traversal Guard using raw http.request
    const rawTraversalStatus = await new Promise((resolve) => {
      const r = http.request({
        host: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/download/../../../etc/passwd',
        method: 'GET'
      }, (res) => resolve(res.statusCode));
      r.end();
    });
    assert.equal(rawTraversalStatus, 403, 'Path traversal attempt with .. must return 403 Forbidden');

    const nullByteStatus = await new Promise((resolve) => {
      const r = http.request({
        host: '127.0.0.1',
        port: TEST_PORT,
        path: '/previews/index.html%00.txt',
        method: 'GET'
      }, (res) => resolve(res.statusCode));
      r.end();
    });
    assert.equal(nullByteStatus, 403, 'Null byte injection must return 403 Forbidden');

    const unknownRoute = await fetch(`${BASE_URL}/nonexistent_page.html`);
    assert.equal(unknownRoute.status, 404);

    // 13. Service Arbitrage: Order with keyword auto-matches and generates pre-fulfillment preview
    const arbitrageOrderRes = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'עו״ד לוי',
        phone: '054-9998877',
        taskDescription: 'צריך לחבר טופס לידים לגוגל שיטס עם webhook',
        budgetNIS: 100
      })
    });
    assert.equal(arbitrageOrderRes.status, 200);
    const arbJson = await arbitrageOrderRes.json();
    assert.equal(arbJson.success, true);
    assert.equal(arbJson.matchedTemplate, 'sheets_webhook');
    assert.ok(arbJson.previewUrl.startsWith('/preview_CUSTOM_'));

    // Check generated pre-fulfillment preview exists and contains As-Is / Bit / 054-6373001
    const arbPreviewRes = await fetch(`${BASE_URL}${arbJson.previewUrl}`);
    assert.equal(arbPreviewRes.status, 200);
    const arbPreviewHtml = await arbPreviewRes.text();
    assert.ok(arbPreviewHtml.includes('054-6373001'));
    assert.ok(arbPreviewHtml.includes('Google Sheets'));

    // 14. Lead Generation Arbitrage: Submit lead from calculator & verify /api/leads endpoint
    const leadRes = await fetch(`${BASE_URL}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'משה ישראלי',
        phone: '052-7778899',
        category: 'lead_arbitrage',
        service: 'mortgage_auditor',
        estimatedValue: 48000,
        taskDescription: 'ליד חיסכון משכנתא: 48,000 ₪'
      })
    });
    assert.equal(leadRes.status, 200);
    const leadJson = await leadRes.json();
    assert.equal(leadJson.success, true);

    const leadsListRes = await fetch(`${BASE_URL}/api/leads`);
    assert.equal(leadsListRes.status, 200);
    const leadsListJson = await leadsListRes.json();
    assert.equal(leadsListJson.count, 1);
    assert.equal(leadsListJson.totalEstimatedNIS, 48000);
    assert.equal(leadsListJson.leads[0].name, 'משה ישראלי');
    assert.equal(leadsListJson.leads[0].service, 'mortgage_auditor');

    // 15. PayBox event tracking in /api/event
    const payboxEvRes = await fetch(`${BASE_URL}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'copy_paybox', itemId: 'mortgage_auditor' })
    });
    assert.equal(payboxEvRes.status, 200);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Cleanup temporary test directory
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {}
  }
});
