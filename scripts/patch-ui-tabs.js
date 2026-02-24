#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspacePage = path.join(process.cwd(), 'src', 'app', 'workspace', '[slug]', 'page.tsx');

function patchWorkspacePage(content) {
  let out = content;

  if (!out.includes("import { ObservabilityDashboard } from '@/components/ObservabilityDashboard';")) {
    out = out.replace(
      "import { SwarmControlRoom } from '@/components/SwarmControlRoom';",
      "import { SwarmControlRoom } from '@/components/SwarmControlRoom';\nimport { ObservabilityDashboard } from '@/components/ObservabilityDashboard';"
    );
  }

  out = out.replace(
    /const \[activeView, setActiveView\] = useState<'swarm' \| 'queue'>\('swarm'\);/,
    "const [activeView, setActiveView] = useState<'swarm' | 'queue' | 'analytics'>('swarm');"
  );

  const startNeedle = '        <div className="px-4 py-2 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">';
  const start = out.indexOf(startNeedle);
  if (start < 0) throw new Error('Cannot find tab start marker.');

  const nextStart = out.indexOf("{activeView === 'swarm' ? <SwarmControlRoom", start);
  if (nextStart < 0 || nextStart <= start) {
    throw new Error('Cannot find tab-to-content boundary after marker.');
  }

  const newTabBlock = [
    '        <div className="px-4 py-2 border-b border-mc-border bg-mc-bg-secondary flex items-center gap-2">',
    '          <button',
    "            onClick={() => setActiveView('swarm')}",
    '            className={`px-3 py-1.5 rounded text-xs ${activeView === \'swarm\' ? \'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50\' : \'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border\'}`',
    '            }',
    '            >',
    '              Swarm Topology',
    '            </button>',
    '            <button',
    "            onClick={() => setActiveView('queue')}",
    '            className={`px-3 py-1.5 rounded text-xs ${activeView === \'queue\' ? \'bg-mc-accent/20 text-mc-accent border border-mc-accent/50\' : \'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border\'}`',
    '            }',
    '            >',
    '              Queue View',
    '            </button>',
    '            <button',
    "            onClick={() => setActiveView('analytics')}",
    '            className={`px-3 py-1.5 rounded text-xs ${activeView === \'analytics\' ? \'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50\' : \'bg-mc-bg-tertiary text-mc-text-secondary border border-mc-border\'}`',
    '            }',
    '            >',
    '              Analytics (Metrics)',
    '            </button>',
    '          </div>',
    '',
  ].join('\n');

  out = `${out.slice(0, start)}${newTabBlock}${out.slice(nextStart)}`;

  out = out.replace(
    "{activeView === 'swarm' ? <SwarmControlRoom /> : <MissionQueue workspaceId={workspace.id} />}",
    "{activeView === 'swarm' ? <SwarmControlRoom /> : activeView === 'queue' ? <MissionQueue workspaceId={workspace.id} /> : <ObservabilityDashboard />}"
  );

  return out;
}

(async function main() {
  try {
    const current = await fs.promises.readFile(workspacePage, 'utf8');
    const next = patchWorkspacePage(current);
    if (next === current) throw new Error('No changes applied to workspace page.');
    await fs.promises.writeFile(workspacePage, next);
    console.log('patched', workspacePage);
  } catch (error) {
    console.error('patch-ui-tabs failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode ?? 0);
  }
})();
