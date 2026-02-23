import path from 'path';
import Database from 'better-sqlite3';
import { MASTER_ROLE_SPECS } from '../config/master-role-specs';

const ROLE_SPECS: Record<string, string> = MASTER_ROLE_SPECS;

const GUARDRAIL_CONTEXT = `> System Context: Current Date & Time is {{CURRENT_DATE}}. Workspace Root is {{WORKSPACE_PATH}}.`;
const GUARDRAIL_TOOLS_1 = `- Allowed Tools: [read_file, web_search, get_market_data] (Use strictly within your domain)`;
const GUARDRAIL_TOOLS_2 = `- Blocked Tools: [write_file, execute_shell, api_post] (Never execute destructive actions without Monica's explicit HITL approval)`;
const GUARDRAIL_JSON = `- CRITICAL: Your Handoff JSON MUST be wrapped in a strictly valid json ... code block. Do NOT include any conversational text or comments inside the JSON block.`;

function injectContextTop(prompt: string): string {
  if (prompt.includes(GUARDRAIL_CONTEXT)) return prompt;
  const identityMatch = prompt.match(/(^|\n)(#+\s*Identity|Identity:|\[ROLE\s*\/\s*IDENTITY\]|##\s*\d+\)\s*Identity|##\s*\d+\)\s*Identity)/i);
  if (!identityMatch || identityMatch.index === undefined) {
    return `${GUARDRAIL_CONTEXT}\n\n${prompt}`;
  }
  const idx = identityMatch.index + (identityMatch[1]?.length ?? 0);
  return `${prompt.slice(0, idx)}${GUARDRAIL_CONTEXT}\n\n${prompt.slice(idx)}`;
}

function injectUnderSection(prompt: string, sectionKeyword: RegExp, lines: string[]): string {
  let updated = prompt;
  for (const line of lines) {
    if (!updated.includes(line)) {
      const match = updated.match(sectionKeyword);
      if (match && match.index !== undefined) {
        const insertAt = updated.indexOf('\n', match.index + match[0].length);
        const pos = insertAt >= 0 ? insertAt + 1 : updated.length;
        updated = `${updated.slice(0, pos)}${line}\n${updated.slice(pos)}`;
      }
    }
  }
  return updated;
}

function ensureSectionWithLines(prompt: string, sectionTitle: string, lines: string[]): string {
  const allExist = lines.every((line) => prompt.includes(line));
  if (allExist) return prompt;
  const block = `\n\n## ${sectionTitle}\n${lines.join('\n')}`;
  return `${prompt}${block}`;
}

function mergeGlobalGuardrails(basePrompt: string): string {
  let merged = injectContextTop(basePrompt);

  merged = injectUnderSection(merged, /(^|\n)(#+\s*Least\s*Privilege|Least\s*Privilege:?)/i, [GUARDRAIL_TOOLS_1, GUARDRAIL_TOOLS_2]);
  if (!merged.includes(GUARDRAIL_TOOLS_1) || !merged.includes(GUARDRAIL_TOOLS_2)) {
    merged = ensureSectionWithLines(merged, 'Least Privilege', [GUARDRAIL_TOOLS_1, GUARDRAIL_TOOLS_2]);
  }

  merged = injectUnderSection(merged, /(^|\n)(#+\s*Output\s*Contract|Output\s*Contract:?)/i, [GUARDRAIL_JSON]);
  if (!merged.includes(GUARDRAIL_JSON)) {
    merged = ensureSectionWithLines(merged, 'Output Contract', [GUARDRAIL_JSON]);
  }

  return merged;
}

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const now = new Date().toISOString();
const roleIds = Object.keys(ROLE_SPECS);

const existingRows = db
  .prepare('SELECT role_id, version FROM agent_roles WHERE role_id IN (' + roleIds.map(() => '?').join(',') + ')')
  .all(...roleIds) as Array<{ role_id: string; version: number }>;

const existingMap = new Map(existingRows.map((r) => [r.role_id, r.version]));
const missingBefore = roleIds.filter((id) => !existingMap.has(id));
if (missingBefore.length) {
  console.error('[seed-role-specs] Missing role_id(s) in DB before update:', missingBefore.join(', '));
  process.exit(1);
}

const updateStmt = db.prepare(
  `UPDATE agent_roles
   SET prompt_template_ref = ?,
       version = version + 1,
       updated_at = ?
   WHERE role_id = ?`
);

let updatedCount = 0;
const tx = db.transaction(() => {
  for (const roleId of roleIds) {
    const mergedPrompt = mergeGlobalGuardrails(ROLE_SPECS[roleId]);
    const result = updateStmt.run(mergedPrompt, now, roleId);
    updatedCount += result.changes;
  }
});

tx();

const verifyRows = db
  .prepare('SELECT role_id, version, prompt_template_ref FROM agent_roles WHERE role_id IN (' + roleIds.map(() => '?').join(',') + ') ORDER BY role_id')
  .all(...roleIds) as Array<{ role_id: string; version: number; prompt_template_ref: string }>;

const missingAfter = roleIds.filter((id) => !verifyRows.some((r) => r.role_id === id));
const guardrailMissing = verifyRows.filter(
  (r) =>
    !r.prompt_template_ref.includes(GUARDRAIL_CONTEXT) ||
    !r.prompt_template_ref.includes(GUARDRAIL_TOOLS_1) ||
    !r.prompt_template_ref.includes(GUARDRAIL_TOOLS_2) ||
    !r.prompt_template_ref.includes(GUARDRAIL_JSON)
);

console.log('=== seed-role-specs ===');
console.log(`dbPath=${dbPath}`);
console.log(`expected=23 updated=${updatedCount}`);
console.log(`missingAfter=${missingAfter.length}`);
if (missingAfter.length) console.log('missingRoleIds=', missingAfter.join(', '));
console.log(`guardrailMissing=${guardrailMissing.length}`);
if (guardrailMissing.length) console.log('guardrailMissingRoleIds=', guardrailMissing.map((r) => r.role_id).join(', '));
console.table(
  verifyRows.map((r) => ({
    role_id: r.role_id,
    version: r.version,
    prompt_len: r.prompt_template_ref.length,
  }))
);

db.close();
