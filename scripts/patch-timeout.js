const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/lib/swarm-executor.ts');
let src = fs.readFileSync(filePath, 'utf8');
const original = src;

function ensureReplace(pattern, replacement, label, mustExist = true) {
  if (!pattern.test(src)) {
    if (mustExist) throw new Error(`[patch-timeout] pattern missing: ${label}`);
    return false;
  }
  const next = src.replace(pattern, replacement);
  const changed = next !== src;
  src = next;
  console.log(`[patch-timeout] ${label}: ${changed ? 'updated' : 'already ok'}`);
  return changed;
}

// 1) streaming wait -> 10 minutes
ensureReplace(/const\s+MAX_WAIT_MS\s*=\s*\d+\s*;/, 'const MAX_WAIT_MS = 600000;', 'MAX_WAIT_MS');

// 2) initial chat.send timeout -> 24 hours
ensureReplace(/(__timeoutMs\s*:\s*)300000(\s*,)/, '$186400000$2', 'initial chat.send timeout', false);
ensureReplace(/(__timeoutMs\s*:\s*)600000(\s*,)/, '$186400000$2', 'initial chat.send timeout (from 600000)', false);

// 3) keep rollback guard in place
if (/failRunAndTaskSafely\(\{[\s\S]*?preserveHitlReview\s*:\s*true[\s\S]*?\}\)/m.test(src)) {
  console.log('[patch-timeout] preserveHitlReview guard: already present');
} else {
  const guardPattern = /failRunAndTaskSafely\(\{([\s\S]*?)report,\s*\}\)/m;
  if (!guardPattern.test(src)) {
    throw new Error('[patch-timeout] cannot inject preserveHitlReview guard');
  }
  src = src.replace(
    guardPattern,
    (_m, g1) => `failRunAndTaskSafely({${g1}report,\n        preserveHitlReview: true,\n      })`
  );
  console.log('[patch-timeout] preserveHitlReview guard: injected');
}

if (src !== original) {
  fs.writeFileSync(filePath, src, 'utf8');
  console.log('[patch-timeout] file written:', filePath);
} else {
  console.log('[patch-timeout] no file changes needed');
}
