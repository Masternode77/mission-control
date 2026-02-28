#!/usr/bin/env node
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LOG_PATH = path.join(process.cwd(), 'logs', 'swarm-traces.jsonl');
const DAILY_LIMIT = Number(process.env.DAILY_TOKEN_LIMIT || 50000);
const TELEGRAM_TARGET = process.env.TELEGRAM_TARGET || '85990941';
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL || 'telegram';
let lastAlertKey = null;

function kstDateKey(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readDailyTokensKst() {
  if (!fs.existsSync(LOG_PATH)) return 0;
  const raw = fs.readFileSync(LOG_PATH, 'utf8');
  const todayKst = kstDateKey(new Date().toISOString());
  let total = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch { continue; }
    const key = kstDateKey(String(row.logged_at || row.started_at || ''));
    if (!key || key !== todayKst) continue;
    const c = Number(row.cost_tokens);
    if (Number.isFinite(c) && c > 0) total += c;
  }
  return total;
}

function sendAlert(total) {
  const msg = `🚨 [예산 초과 경고] 일일 토큰 한도 도달\n- today_kst_tokens: ${total}\n- limit: ${DAILY_LIMIT}`;
  const args = ['message', 'send', '--channel', TELEGRAM_CHANNEL, '--target', TELEGRAM_TARGET, '--message', msg];
  execFile('openclaw', args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[cost-monitor] alert send failed:', err.message);
      if (stderr) console.error(stderr.toString());
      return;
    }
    if (stdout) console.log(stdout.toString().trim());
    console.log('[cost-monitor] alert sent');
  });
}

function checkBudget() {
  try {
    const total = readDailyTokensKst();
    const now = new Date();
    const hourKey = `${kstDateKey(now.toISOString())} ${String((now.getUTCHours() + 9) % 24).padStart(2, '0')}`;
    console.log(`[cost-monitor] kst_daily_tokens=${total} limit=${DAILY_LIMIT}`);
    if (total > DAILY_LIMIT && lastAlertKey !== hourKey) {
      sendAlert(total);
      lastAlertKey = hourKey;
    }
  } catch (e) {
    console.error('[cost-monitor] check failed:', e instanceof Error ? e.message : String(e));
  }
}

cron.schedule('0 * * * *', checkBudget, { timezone: 'Asia/Seoul' });
console.log('[cost-monitor] started (hourly @ minute 0, Asia/Seoul)');
checkBudget();
