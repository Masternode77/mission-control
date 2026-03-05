import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { run, queryOne, transaction } from '@/lib/db';
import { sendTelegramMessage } from '@/lib/telegram';
import { translateForKoreanCLevel } from '@/lib/translator';

export const REPORTS_DIR = '/Users/josh/.openclaw/workspace/deliverables/reports/';
const VECTOR_DB = '/Users/josh/.openclaw/workspace/vector_store.db';

function nowIso() {
  return new Date().toISOString();
}

async function exportMarkdownToPdf(markdown: string, pdfPath: string, title: string) {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:36px;line-height:1.55;color:#111}h1,h2,h3{margin-top:24px}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}ul{padding-left:20px}</style></head><body>${markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '<br/><br/>')}</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' } });
  } finally {
    await browser.close();
  }
}

export async function createReportPipeline(params: {
  title: string;
  content: string;
  taskId?: string;
  workspaceId?: string;
  telegramChatId?: string;
}) {
  const id = uuidv4();
  const createdAt = nowIso();
  const translatedContent = translateForKoreanCLevel(params.content);
  const safeName = params.title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report';
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = path.join(REPORTS_DIR, `${createdAt.slice(0, 10)}-${safeName}-${id.slice(0, 8)}.md`);

  // single atomic start: local save + db register
  const pdfPath = filePath.replace(/\.md$/i, '.pdf');

  transaction(() => {
    fs.writeFileSync(filePath, translatedContent, 'utf8');
    run(
      `INSERT INTO report_runs (id, task_id, workspace_id, title, file_path, status, telegram_chat_id, telegram_status, index_status, pdf_path, pdf_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'created', ?, 'pending', 'pending', ?, 'pending', ?, ?)`,
      [id, params.taskId || null, params.workspaceId || 'default', params.title, filePath, params.telegramChatId || process.env.TELEGRAM_MASTER_CHAT_ID || null, pdfPath, createdAt, createdAt]
    );

    if (params.taskId) {
      const baseTask = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [params.taskId]);
      if (baseTask?.id) {
        run(
          `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, path, description, created_at)
           VALUES (?, ?, 'report', ?, ?, '3-way sync report artifact', ?)`,
          [uuidv4(), params.taskId, params.title, filePath, createdAt]
        );
      }
    }
  });

  // pdf export
  try {
    await exportMarkdownToPdf(translatedContent, pdfPath, params.title);
    run(`UPDATE report_runs SET pdf_status='exported', updated_at=? WHERE id=?`, [nowIso(), id]);
  } catch (e: any) {
    run(`UPDATE report_runs SET pdf_status='failed', status='failed', error_message=COALESCE(error_message,'') || ?, updated_at=? WHERE id=?`, [` | pdf:${String(e?.message || e).slice(0, 400)}`, nowIso(), id]);
  }

  // distribution
  let telegramMessageId: string | null = null;
  try {
    const summary = translatedContent.split('\n').slice(0, 20).join('\n');
    const resp = await sendTelegramMessage({
      chatId: params.telegramChatId || process.env.TELEGRAM_MASTER_CHAT_ID,
      text: `🧾 Report Published\n${params.title}\n\n${summary}`,
    });
    if (resp?.ok) {
      const j = await resp.json().catch(() => null as any);
      telegramMessageId = j?.result?.message_id ? String(j.result.message_id) : null;
      run(`UPDATE report_runs SET telegram_status='sent', telegram_message_id=?, status='sent', updated_at=? WHERE id=?`, [telegramMessageId, nowIso(), id]);
    } else {
      const err = resp ? await resp.text().catch(() => 'telegram_send_failed') : 'telegram_no_response';
      run(`UPDATE report_runs SET telegram_status='failed', status='failed', error_message=?, updated_at=? WHERE id=?`, [String(err).slice(0, 1000), nowIso(), id]);
    }
  } catch (e: any) {
    run(`UPDATE report_runs SET telegram_status='failed', status='failed', error_message=?, updated_at=? WHERE id=?`, [String(e?.message || e).slice(0, 1000), nowIso(), id]);
  }

  // indexing
  try {
    const vecDb = new Database(VECTOR_DB);
    vecDb.exec(`CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, vector BLOB NOT NULL, payload TEXT NOT NULL)`);
    const payload = JSON.stringify({
      type: 'report_run',
      report_run_id: id,
      title: params.title,
      file_path: filePath,
      content: translatedContent,
      indexed_at: nowIso(),
    });
    const vec = Buffer.alloc(32);
    vecDb.prepare(`INSERT INTO vectors (id, vector, payload) VALUES (?, ?, ?)`).run(uuidv4(), vec, payload);
    vecDb.close();
    run(`UPDATE report_runs SET index_status='indexed', status=CASE WHEN telegram_status='sent' THEN 'indexed' ELSE status END, updated_at=? WHERE id=?`, [nowIso(), id]);
  } catch (e: any) {
    run(`UPDATE report_runs SET index_status='failed', status='failed', error_message=COALESCE(error_message,'') || ?, updated_at=? WHERE id=?`, [` | index:${String(e?.message || e).slice(0, 400)}`, nowIso(), id]);
  }

  return queryOne<any>('SELECT * FROM report_runs WHERE id = ?', [id]);
}

export async function retryReportRun(id: string, step: 'send' | 'index' | 'pdf' | 'all' = 'all') {
  const row = queryOne<any>('SELECT * FROM report_runs WHERE id = ?', [id]);
  if (!row) throw new Error('report_run_not_found');
  const content = fs.readFileSync(row.file_path, 'utf8');

  if (step === 'pdf' || step === 'all') {
    try {
      const pdfPath = row.pdf_path || String(row.file_path).replace(/\.md$/i, '.pdf');
      await exportMarkdownToPdf(content, pdfPath, row.title);
      run(`UPDATE report_runs SET pdf_path=?, pdf_status='exported', updated_at=? WHERE id=?`, [pdfPath, nowIso(), id]);
    } catch {
      run(`UPDATE report_runs SET pdf_status='failed', status='failed', updated_at=? WHERE id=?`, [nowIso(), id]);
    }
  }

  if (step === 'send' || step === 'all') {
    try {
      const resp = await sendTelegramMessage({ chatId: row.telegram_chat_id || process.env.TELEGRAM_MASTER_CHAT_ID, text: `🔁 Retry Report\n${row.title}` });
      if (resp?.ok) {
        const j = await resp.json().catch(() => null as any);
        const msgId = j?.result?.message_id ? String(j.result.message_id) : null;
        run(`UPDATE report_runs SET telegram_status='sent', telegram_message_id=?, updated_at=? WHERE id=?`, [msgId, nowIso(), id]);
      } else {
        run(`UPDATE report_runs SET telegram_status='failed', status='failed', updated_at=? WHERE id=?`, [nowIso(), id]);
      }
    } catch {
      run(`UPDATE report_runs SET telegram_status='failed', status='failed', updated_at=? WHERE id=?`, [nowIso(), id]);
    }
  }

  if (step === 'index' || step === 'all') {
    try {
      const vecDb = new Database(VECTOR_DB);
      const payload = JSON.stringify({ type: 'report_run_retry', report_run_id: id, title: row.title, file_path: row.file_path, content, indexed_at: nowIso() });
      const vec = Buffer.alloc(32);
      vecDb.prepare(`INSERT INTO vectors (id, vector, payload) VALUES (?, ?, ?)`).run(uuidv4(), vec, payload);
      vecDb.close();
      run(`UPDATE report_runs SET index_status='indexed', updated_at=? WHERE id=?`, [nowIso(), id]);
    } catch {
      run(`UPDATE report_runs SET index_status='failed', status='failed', updated_at=? WHERE id=?`, [nowIso(), id]);
    }
  }

  run(`UPDATE report_runs SET status = CASE WHEN telegram_status='sent' AND index_status='indexed' THEN 'indexed' WHEN telegram_status='failed' OR index_status='failed' THEN 'failed' ELSE status END, updated_at=? WHERE id=?`, [nowIso(), id]);
  return queryOne<any>('SELECT * FROM report_runs WHERE id = ?', [id]);
}
