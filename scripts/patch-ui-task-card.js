#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src', 'components', 'MissionQueue.tsx');

(function main() {
  try {
    let content = fs.readFileSync(target, 'utf8');
    const original = content;

    const taskCardMarker = 'function TaskCard({';
    if (!content.includes(taskCardMarker)) throw new Error('TaskCard marker missing');

    const helperBlock = String.raw`
function getTaskIntentCategory(metadata: ReturnType<typeof parseMetadata>, task: QueueTask): string {
  const direct = String(
    (metadata?.intent as string) ||
      (metadata?.intent_category as string) ||
      (metadata?.category as string) ||
      (metadata?.intentTag as string) ||
      (metadata?.phase_tag as string) ||
      ''
  ).trim().toUpperCase();

  if (direct.includes('DATA_CENTER_DEAL')) return 'DATA_CENTER_DEAL';
  if (direct.includes('MACRO_CRYPTO')) return 'MACRO_CRYPTO';
  if (direct.includes('SYSTEM_OPS')) return 'SYSTEM_OPS';
  if (direct.includes('GENERAL_CHIT_CHAT')) return 'GENERAL_CHIT_CHAT';

  const target = (String(task.title || "") + ' ' + String(task.description || "")).toLowerCase();
  let dc = 0, crypto = 0, ops = 0;
  if (/(adat|adik|data\s*center|datacenter|colocation|코로케이션|rack|캡레이트|hyperscale|서버|전력|용량|capacity|site|사이트)/.test(target)) dc += 1;
  if (/(비트코인|btc|crypto|금리|환율|유동성|macro|macro\s*economy|fed|인플레이션|채권|달러|경제|gdp|리스크)/.test(target)) crypto += 1;
  if (/(에이전트|agent|미션\s*컨트롤|swarm|task|status|로그|모니터|build|배포|deploy|오케스트|telegram|webhook|queue|ops)/.test(target)) ops += 1;

  if (dc >= crypto && dc >= ops && dc > 0) return 'DATA_CENTER_DEAL';
  if (crypto >= dc && crypto >= ops && crypto > 0) return 'MACRO_CRYPTO';
  if (ops >= dc && ops >= crypto && ops > 0) return 'SYSTEM_OPS';
  return 'GENERAL_CHIT_CHAT';
}

function getIntentBadgeClass(intent: string) {
  switch (intent) {
    case 'DATA_CENTER_DEAL':
      return 'bg-blue-500/20 text-blue-300 border-blue-400/40';
    case 'MACRO_CRYPTO':
      return 'bg-orange-500/20 text-orange-300 border-orange-400/40';
    case 'SYSTEM_OPS':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-400/40';
  }
}

function getSquadIcons(task: QueueTask, metadata: ReturnType<typeof parseMetadata>): string[] {
  const src = String([
    task.assigned_agent?.name || '',
    task.assigned_agent?.id || '',
    String((metadata as any)?.squad || ''),
    String((metadata as any)?.role || ''),
    String((metadata as any)?.team || ''),
  ].join(' ')).toLowerCase();

  const icons = new Set<string>();
  if (src.includes('dc') || src.includes('colocation') || src.includes('코로케이션') || src.includes('adat')) icons.add('🏢');
  if (src.includes('macro') || src.includes('crypto') || src.includes('비트코인') || src.includes('금리')) icons.add('📊');
  if (src.includes('legal') || src.includes('법') || src.includes('compliance') || src.includes('규정')) icons.add('⚖️');
  return Array.from(icons);
}

`;

    if (!content.includes('function getTaskIntentCategory(metadata: ReturnType<typeof parseMetadata>, task: QueueTask): string {')) {
      content = content.replace(taskCardMarker, `${helperBlock}${taskCardMarker}`);
    }

    const oldMetadata =
      '  const metadata = parseMetadata(task.metadata);\n  const isTelegramTask = Boolean(metadata?.telegram_chat_id);';
    const newMetadata =
      '  const metadata = parseMetadata(task.metadata);\n' +
      '  const taskIntent = getTaskIntentCategory(metadata, task);\n' +
      '  const taskIntentBadge = getIntentBadgeClass(taskIntent);\n' +
      '  const squadIcons = getSquadIcons(task, metadata);\n' +
      '  const isTelegramTask = Boolean(metadata?.telegram_chat_id);';
    if (content.includes(oldMetadata) && !content.includes('const taskIntent = getTaskIntentCategory(metadata, task);')) {
      content = content.replace(oldMetadata, newMetadata);
    }

    content = content.replace(
      'className={`group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 ',
      'className={`relative group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 '
    );

    const oldHeader =
      '        <div className="flex items-center justify-between gap-2 mb-2">\n          <div className="flex items-center gap-2">\n            {isSubtask && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/40">↳ Subtask</span>}\n            {isTelegramTask && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/40">✈️ Telegram</span>}\n            {task.is_rework && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">Rework</span>}\n          </div>\n        </div>';
    const newHeader =
      '        <div className="flex items-center justify-between gap-2 mb-2">\n' +
      '          <div className="flex items-center gap-2">\n' +
      '            {isSubtask && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/40">↳ Subtask</span>}\n' +
      '            {isTelegramTask && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/40">✈️ Telegram</span>}\n' +
      '            {task.is_rework && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">Rework</span>}\n' +
      '          </div>\n' +
      '          <span className={`text-[10px] px-2 py-0.5 rounded border ${taskIntentBadge}`}>{taskIntent}</span>\n' +
      '        </div>';
    if (content.includes(oldHeader) && !content.includes('taskIntentBadge')) {
      content = content.replace(oldHeader, newHeader);
    }

    const oldFooter =
      '        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">\n          <div className="flex items-center gap-1.5">\n            <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />\n            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>\n          </div>\n          <span className="text-[10px] text-mc-text-secondary/60">{formatDistanceToNow(new Date(task.updated_at || task.created_at), { addSuffix: true })}</span>\n        </div>';
    const newFooter =
      '        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">\n' +
      '          <div className="flex items-center gap-2">\n' +
      '            <div className="flex items-center gap-1.5">\n' +
      '              <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />\n' +
      '              <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>\n' +
      '            </div>\n' +
      '            {squadIcons.length > 0 && (\n' +
      '              <div className="flex items-center gap-1">\n' +
      '                {squadIcons.map((icon) => (\n' +
      '                  <span key={icon} className="text-sm">{icon}</span>\n' +
      '                ))}\n' +
      '              </div>\n' +
      '            )}\n' +
      '          </div>\n' +
      '          <span className="text-[10px] text-mc-text-secondary/60">{formatDistanceToNow(new Date(task.updated_at || task.created_at), { addSuffix: true })}</span>\n' +
      '        </div>';
    if (content.includes(oldFooter) && !content.includes('squadIcons.length')) {
      content = content.replace(oldFooter, newFooter);
    }

    if (content === original) {
      console.log('patch already present; no changes made.');
      process.exit(0);
    }

    fs.writeFileSync(target, content, 'utf8');
    console.log('patched', target);
  } catch (error) {
    console.error('patch-ui-task-card failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
})();
