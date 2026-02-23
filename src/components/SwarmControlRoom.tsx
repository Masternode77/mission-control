'use client';

import { useState } from 'react';
import type { Node } from '@xyflow/react';
import { useSwarmTopology } from '@/hooks/useSwarmTopology';
import { SwarmTopologyCanvas } from './SwarmTopologyCanvas';
import { HITLZone } from './HITLZone';

export function SwarmControlRoom() {
  const { data, loading, error } = useSwarmTopology();
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (loading) {
    return <div className="p-6 text-mc-text-secondary">Loading Swarm topology...</div>;
  }

  if (error || !data) {
    return <div className="p-6 text-mc-accent-red">Failed to load topology: {error}</div>;
  }

  const commandStream = data.command_stream ?? [];
  const flowText = commandStream[0]
    ? `Josh → MC-MAIN → DC-FIN :: ${commandStream[0].message}`
    : 'Josh → MC-MAIN → DC-FIN :: awaiting command';

  return (
    <div className="flex-1 flex gap-4 p-4 bg-mc-bg min-h-0">
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="mb-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2 overflow-hidden">
          <div className="command-stream-text">{flowText}</div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wider text-cyan-300">Swarm Topology View</h2>
          <div className="text-xs text-mc-text-secondary">
            Active Runs: <span className="text-cyan-300">{data.stats.active_runs}</span> ·
            Proactive: <span className="text-emerald-300">{data.stats.proactive_open_tasks}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <SwarmTopologyCanvas topology={data} onNodeSelect={setSelectedNode} />
        </div>
      </section>

      <aside className={`${sidebarCollapsed ? 'w-10' : 'w-[360px]'} transition-all duration-200 min-h-0 flex flex-col`}>
        <div className="mb-2 flex justify-end">
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="px-2 py-1 text-xs rounded border border-mc-border bg-mc-bg-tertiary hover:bg-mc-bg"
            title={sidebarCollapsed ? 'Open right panel' : 'Collapse right panel'}
          >
            {sidebarCollapsed ? '[<]' : '[>]'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            <HITLZone pendingApprovals={data.hitl.pending_approvals} />
            <div className="rounded-xl border border-mc-border p-4 text-xs text-mc-text-secondary max-h-[320px] overflow-auto">
              <div className="mb-2 text-cyan-300 uppercase tracking-wider">Control Notes</div>
              <ul className="space-y-2">
                {commandStream.map((e) => (
                  <li key={e.id} className="border-b border-mc-border/60 pb-1">
                    <span className="text-cyan-400">[{e.type}]</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`node-slideout ${selectedNode ? 'open' : ''}`}>
              <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Node Detail</div>
              {selectedNode ? (
                <div className="text-xs space-y-2">
                  <div><span className="text-mc-text-secondary">id:</span> {selectedNode.id}</div>
                  <div><span className="text-mc-text-secondary">position:</span> {Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</div>
                </div>
              ) : (
                <div className="text-xs text-mc-text-secondary">노드를 클릭하면 상세 패널이 열립니다.</div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
