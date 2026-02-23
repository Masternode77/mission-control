import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3005';
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');

const markers = {
  old: `E2E OLD ARCHIVE TASK ${Date.now()}`,
  recent: `E2E RECENT COMPLETED TASK ${Date.now()}`,
};

function seedArchiveFixtures() {
  const db = new Database(dbPath);
  const now = new Date();
  const old = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

  const ins = db.prepare(`
    INSERT INTO swarm_tasks (task_id, ws, title, objective, owner_role_id, priority, risk_tier, status, origin_type, created_by, created_at, updated_at)
    VALUES (?, 'default', ?, ?, 'MC-MAIN', 'P2', 'medium', 'completed', 'topdown', 'e2e-test', ?, ?)
  `);

  const id1 = `e2e-old-${Date.now()}`;
  const id2 = `e2e-recent-${Date.now()}`;
  ins.run(id1, markers.old, 'archive visibility test old', old, old);
  ins.run(id2, markers.recent, 'archive visibility test recent', recent, recent);
  db.close();
}

async function run() {
  seedArchiveFixtures();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  const report = [];

  try {
    await page.goto(`${BASE_URL}/workspace/default`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Switch to Queue View
    await page.getByRole('button', { name: 'Queue View' }).click();
    await page.waitForTimeout(500);

    // Scenario 1: Cmd/Ctrl+K opens SearchPalette + results render
    await page.keyboard.press('Control+KeyK');
    await page.waitForSelector('input[placeholder="Search tasks, descriptions, deliverables..."]', { timeout: 10000 });
    await page.fill('input[placeholder="Search tasks, descriptions, deliverables..."]', 'ORBITAL-DC-7788');
    await page.waitForTimeout(700);

    const searchResultCount = await page.locator('button:has-text("deliverable"), button:has-text("task"), button:has-text("description")').count();
    if (searchResultCount < 1) throw new Error('Search results did not render');
    report.push(`1) 글로벌 검색: PASS (results=${searchResultCount})`);

    // Scenario 2: click result opens TaskModal
    const firstResult = page.locator('button:has-text("deliverable"), button:has-text("task"), button:has-text("description")').first();
    await firstResult.click();
    await page.waitForTimeout(500);

    const modalVisible = await page.locator('div.fixed.inset-0').first().isVisible();
    const hasTabs = await page.getByText('Deliverables').first().isVisible();
    if (!modalVisible || !hasTabs) throw new Error('TaskModal did not open from search result click');
    report.push('2) 검색 연동(TaskModal 오픈): PASS');

    // close modal (switch to overview and cancel)
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(300);

    // Scenario 3: Archive toggle hide/show old completed cards
    const oldVisibleBefore = await page.getByText(markers.old).count();
    const recentVisibleBefore = await page.getByText(markers.recent).count();

    if (oldVisibleBefore !== 0) throw new Error('Old completed task should be hidden by default but is visible');
    if (recentVisibleBefore < 1) throw new Error('Recent completed task should be visible by default but is not');

    await page.getByLabel('Show archived completed (>=7d)').check();
    await page.waitForTimeout(400);

    const oldVisibleAfterOn = await page.getByText(markers.old).count();
    if (oldVisibleAfterOn < 1) throw new Error('Old completed task did not appear after enabling archive toggle');

    await page.getByLabel('Show archived completed (>=7d)').uncheck();
    await page.waitForTimeout(400);

    const oldVisibleAfterOff = await page.getByText(markers.old).count();
    if (oldVisibleAfterOff !== 0) throw new Error('Old completed task did not hide again after disabling archive toggle');

    report.push('3) 아카이빙 토글(숨김/재표시): PASS');

    await page.screenshot({ path: 'e2e-ui-pass.png', fullPage: true });

    console.log('E2E_UI_REPORT_START');
    for (const line of report) console.log(line);
    console.log('Artifacts: e2e-ui-pass.png');
    console.log('E2E_UI_REPORT_END');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('E2E failed:', err);
  process.exit(1);
});
