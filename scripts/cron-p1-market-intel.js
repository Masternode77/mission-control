#!/usr/bin/env node
const cron = require('node-cron');
const { execFile } = require('node:child_process');
const path = require('path');

const CYCLE_SCRIPT = path.join(process.cwd(), 'scripts', 'p1-market-intel-cycle.js');
const SCHEDULE = process.env.P1_MARKET_INTEL_CRON || '*/30 * * * *'; // every 30 min

function runCycle() {
  const started = new Date().toISOString();
  execFile(process.execPath, [CYCLE_SCRIPT], { cwd: process.cwd() }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[p1-cron] cycle failed @ ${started}:`, err.message);
      if (stderr) console.error(stderr.trim());
      return;
    }
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  });
}

cron.schedule(SCHEDULE, runCycle, { timezone: 'Asia/Seoul' });
console.log(`[p1-cron] started schedule=${SCHEDULE} tz=Asia/Seoul`);
runCycle();
