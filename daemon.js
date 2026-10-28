#!/usr/bin/env node
/**
 * daemon.js
 * מנהל הריצה האוטונומי של אתגר 100 השקלים היומי (Project #4: 100 NIS Autonomous Daemon)
 * - ניטור רציף וריפוי עצמי (Self-Healing) של שרת המערכת (Port 8800)
 * - בדיקת זמינות תקופתית (Heartbeat) כל 15 שניות
 * - רישום טלמטריה ומעקב חי אחר התקדמות לעבר יעד 100 ₪ ראשונים
 * - מניעת כפילויות תהליכים (Singleton Guard via daemon.pid)
 * - ניקוי וסגירת תהליכים תלויים בעת שחזור שרת (Zombie/Port-conflict protection)
 * - תיעוד מסודר ב-daemon.log וב-daemon_status.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WORKSPACE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8800);
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const STATUS_FILE = path.join(WORKSPACE, 'daemon_status.json');
const LOG_FILE = path.join(WORKSPACE, 'daemon.log');
const PROGRESS_FILE = path.join(WORKSPACE, 'daily_progress.json');
const TELEMETRY_FILE = path.join(WORKSPACE, 'telemetry.json');
const ORDERS_FILE = path.join(WORKSPACE, 'inbound_orders.json');
const DAEMON_PID_FILE = path.join(WORKSPACE, 'daemon.pid');
const SERVER_PID_FILE = path.join(WORKSPACE, 'server.pid');

let serverProcess = null;
let isStopping = false;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
  process.stdout.write(line);
}

function loadJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function checkSingleton() {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const existingPid = Number(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim());
      if (existingPid && existingPid !== process.pid) {
        process.kill(existingPid, 0); // Check if alive
        log(`Another daemon instance is already active (PID=${existingPid}). Exiting gracefully.`);
        process.exit(0);
      }
    } catch {}
  }
  try {
    fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), 'utf8');
  } catch {}
}

function cleanDaemonPid() {
  try {
    if (fs.existsSync(DAEMON_PID_FILE)) {
      const recorded = Number(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim());
      if (recorded === process.pid) {
        fs.unlinkSync(DAEMON_PID_FILE);
      }
    }
  } catch {}
}

async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/api/status`, {
      signal: AbortSignal.timeout(2500)
    });
    if (res.status === 200) {
      const data = await res.json();
      return { healthy: true, data };
    }
  } catch (err) {
    return { healthy: false, error: err.message };
  }
  return { healthy: false, error: 'Non-200 status' };
}

function terminateLingeringServer() {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
    } catch {}
    serverProcess = null;
  }

  if (fs.existsSync(SERVER_PID_FILE)) {
    try {
      const pid = Number(fs.readFileSync(SERVER_PID_FILE, 'utf8').trim());
      if (pid && pid !== process.pid) {
        process.kill(pid, 'SIGTERM');
        log(`Terminated lingering server process (PID=${pid}) before restart`);
      }
    } catch {}
    try {
      if (fs.existsSync(SERVER_PID_FILE)) fs.unlinkSync(SERVER_PID_FILE);
    } catch {}
  }
}

function startServerProcess() {
  terminateLingeringServer();

  log(`Starting server process on port ${PORT}...`);
  serverProcess = spawn(process.execPath, [path.join(WORKSPACE, 'server.js')], {
    cwd: WORKSPACE,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (d) => {
    fs.appendFileSync(LOG_FILE, `[SERVER_OUT] ${d.toString()}`);
  });
  serverProcess.stderr.on('data', (d) => {
    fs.appendFileSync(LOG_FILE, `[SERVER_ERR] ${d.toString()}`);
  });

  serverProcess.on('exit', (code, sig) => {
    log(`Server process exited (code=${code}, signal=${sig})`);
    serverProcess = null;
  });
}

async function ensureServerRunning() {
  const health = await checkHealth();
  if (health.healthy) {
    return health.data;
  }

  log(`Server unhealthy or down (${health.error || 'unknown'}). Triggering restart...`);
  startServerProcess();

  // המתנה לעליית השרת
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 600));
    const recheck = await checkHealth();
    if (recheck.healthy) {
      log(`Server successfully restored on port ${PORT}`);
      return recheck.data;
    }
  }

  log(`Warning: Server did not respond after restart attempt.`);
  return null;
}

function updateDaemonMetrics(serverData) {
  const telemetry = loadJson(TELEMETRY_FILE, {});
  const orders = loadJson(ORDERS_FILE, []);
  const progress = loadJson(PROGRESS_FILE, { targetGoalNIS: 100, currentCollectedNIS: 0 });

  const status = {
    updatedAt: new Date().toISOString(),
    daemonPid: process.pid,
    daemonUptimeSeconds: Math.round(process.uptime()),
    serverHealthy: !!serverData,
    serverPort: PORT,
    targetGoalNIS: progress.targetGoalNIS || 100,
    currentCollectedNIS: progress.currentCollectedNIS || 0,
    percentComplete: progress.percentComplete || 0,
    metrics: {
      pageViews: telemetry.pageViews || 0,
      bitCopyClicks: telemetry.bitCopyClicks || 0,
      customOrdersCount: orders.length,
      successfulUnlocks: telemetry.successfulUnlocks || 0
    },
    latestOrders: orders.slice(-5)
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
  } catch {}

  return status;
}

async function loop() {
  checkSingleton();
  log(`Starting 100 NIS Challenge Daemon loop (PID=${process.pid})...`);

  // בדיקה ראשונית
  const serverData = await ensureServerRunning();
  updateDaemonMetrics(serverData);

  const interval = setInterval(async () => {
    if (isStopping) return;
    try {
      const data = await ensureServerRunning();
      const status = updateDaemonMetrics(data);
      log(`Heartbeat: Port=${PORT} | Views=${status.metrics.pageViews} | BitClicks=${status.metrics.bitCopyClicks} | Orders=${status.metrics.customOrdersCount} | Progress=${status.percentComplete}%`);
    } catch (err) {
      log(`Error in daemon loop: ${err.message}`);
    }
  }, 15000);

  function shutdown() {
    if (isStopping) return;
    isStopping = true;
    clearInterval(interval);
    log('Gracefully stopping daemon...');
    cleanDaemonPid();
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch {}
    }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', cleanDaemonPid);
}

// תמיכה בהרצה חד-פעמית לבדיקת סטטוס
if (process.argv.includes('--status')) {
  const health = await checkHealth();
  const daemonStatus = loadJson(STATUS_FILE, {});
  console.log(JSON.stringify({
    serverOnline: health.healthy,
    serverUrl: SERVER_URL,
    serverData: health.data || null,
    daemonStatus
  }, null, 2));
  process.exit(0);
}

if (process.argv.includes('--once')) {
  const serverData = await ensureServerRunning();
  const status = updateDaemonMetrics(serverData);
  console.log('Single pass completed:', status);
  process.exit(0);
}

loop().catch((err) => {
  console.error('Fatal daemon error:', err);
  cleanDaemonPid();
  process.exit(1);
});
