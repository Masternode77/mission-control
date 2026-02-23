'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { AgentModal } from './AgentModal';
import { DiscoverAgentsModal } from './DiscoverAgentsModal';
import { AgentConfigDrawer, type RoleConfigModel } from './AgentConfigDrawer';
import { useGlobalSSE } from '@/providers/SSEProvider';

type FilterTab = 'all' | 'working' | 'standby';

type SwarmRole = {
  id: string;
  role_id: string;
  display_name: string;
  domain: string;
  profile_type: string;
  system_prompt?: string;
  version: number;
  enabled: boolean;
  running_runs: number;
  total_runs: number;
  status: 'working' | 'standby';
};

interface AgentsSidebarProps {
  workspaceId?: string;
}

export function AgentsSidebar({ workspaceId }: AgentsSidebarProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [isMinimized, setIsMinimized] = useState(false);
  const [roles, setRoles] = useState<SwarmRole[]>([]);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleConfigModel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sequence, lastEvent } = useGlobalSSE();

  const loadRoles = useCallback(async () => {
    try {
      const res = await fetch(`/api/swarm/roles?workspace_id=${workspaceId || 'all'}`);
      if (res.ok) {
        const data = (await res.json()) as SwarmRole[];
        setRoles(data);
        setExpandedDomains((prev) => {
          const next = { ...prev };
          Array.from(new Set(data.map((r) => r.domain || 'SHARED'))).forEach((domain) => {
            if (!(domain in next)) next[domain] = true;
          });
          return next;
        });
      }
    } catch (error) {
      console.error('Failed to fetch swarm roles:', error);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadRoles();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [loadRoles]);

  useEffect(() => {
    if (!lastEvent) return;
    const summary = lastEvent.type === 'event_logged' ? String((lastEvent.payload as { summary?: string })?.summary || '') : '';
    const shouldReload =
      (lastEvent.type === 'event_logged' && /role_config_updated|task_|run_|hitl_|REWORK|EXECUTOR/.test(summary)) ||
      lastEvent.type === 'agent_spawned' ||
      lastEvent.type === 'agent_completed' ||
      lastEvent.type === 'task_updated' ||
      lastEvent.type === 'task_created' ||
      lastEvent.type === 'task_deleted';

    if (!shouldReload) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadRoles();
    }, 700);
  }, [sequence, lastEvent, loadRoles]);

  const filteredRoles = useMemo(() => roles.filter((r) => (filter === 'all' ? true : r.status === filter)), [roles, filter]);

  const groupedRoles = useMemo(() => {
    return filteredRoles.reduce<Record<string, SwarmRole[]>>((acc, role) => {
      const key = role.domain || 'SHARED';
      if (!acc[key]) acc[key] = [];
      acc[key].push(role);
      return acc;
    }, {});
  }, [filteredRoles]);

  const toggleDomain = (domain: string) => setExpandedDomains((prev) => ({ ...prev, [domain]: !prev[domain] }));

  return (
    <>
      <aside className={`bg-mc-bg-secondary border-r border-mc-border flex flex-col transition-all duration-300 ease-in-out ${isMinimized ? 'w-12' : 'w-72'}`}>
        <div className="p-3 border-b border-mc-border">
          <div className="flex items-center">
            <button onClick={() => setIsMinimized((v) => !v)} className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors" aria-label={isMinimized ? 'Expand agents' : 'Minimize agents'}>
              {isMinimized ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            {!isMinimized && (
              <>
                <span className="text-sm font-medium uppercase tracking-wider">Swarm Agents</span>
                <span className="bg-mc-bg-tertiary text-mc-text-secondary text-xs px-2 py-0.5 rounded ml-2">{filteredRoles.length}</span>
              </>
            )}
          </div>

          {!isMinimized && (
            <div className="flex gap-1 mt-3">
              {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
                <button key={tab} onClick={() => setFilter(tab)} className={`px-3 py-1 text-xs rounded uppercase ${filter === tab ? 'bg-mc-accent text-mc-bg font-medium' : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'}`}>
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>

        {!isMinimized && (
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {Object.entries(groupedRoles).map(([domain, domainRoles]) => {
              const isOpen = expandedDomains[domain] ?? true;
              const workingCount = domainRoles.filter((r) => r.status === 'working').length;

              return (
                <div key={domain} className="rounded-lg border border-mc-border/70 overflow-hidden">
                  <button onClick={() => toggleDomain(domain)} className="w-full px-3 py-2 bg-mc-bg-tertiary/50 flex items-center justify-between text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronDown className={`w-4 h-4 text-mc-text-secondary transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      <span className="text-sm font-medium text-cyan-300 truncate">{domain}</span>
                    </div>
                    <div className="text-xs text-mc-text-secondary">{domainRoles.length} · <span className="text-green-400">{workingCount} active</span></div>
                  </button>

                  {isOpen && (
                    <div className="p-1.5 space-y-1 bg-mc-bg-secondary/70">
                      {domainRoles.map((role) => (
                        <button
                          key={role.id}
                          onClick={() =>
                            setSelectedRole({
                              role_id: role.role_id,
                              display_name: role.display_name,
                              domain: role.domain,
                              system_prompt: role.system_prompt || '',
                              version: role.version || 1,
                            })
                          }
                          className="w-full text-left px-2.5 py-2 rounded hover:bg-mc-bg-tertiary transition-colors border border-transparent hover:border-mc-border/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium truncate">{role.display_name}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded uppercase ${role.status === 'working' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-300'}`}>{role.status}</span>
                          </div>
                          <div className="text-xs text-mc-text-secondary mt-1">{role.profile_type} · runs {role.running_runs}/{role.total_runs}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isMinimized && (
          <div className="p-3 border-t border-mc-border space-y-2">
            <button onClick={() => setShowCreateModal(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-mc-bg-tertiary hover:bg-mc-border rounded text-sm text-mc-text-secondary hover:text-mc-text transition-colors"><Plus className="w-4 h-4" />Add Agent</button>
            <button onClick={() => setShowDiscoverModal(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded text-sm text-blue-400 hover:text-blue-300 transition-colors"><Search className="w-4 h-4" />Import from Gateway</button>
          </div>
        )}

        {showCreateModal && <AgentModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />}
        {showDiscoverModal && <DiscoverAgentsModal onClose={() => setShowDiscoverModal(false)} workspaceId={workspaceId} />}
      </aside>

      <AgentConfigDrawer
        role={selectedRole}
        onClose={() => setSelectedRole(null)}
        onSaved={(updated) => {
          setRoles((prev) =>
            prev.map((r) =>
              r.role_id === updated.role_id
                ? {
                    ...r,
                    display_name: updated.display_name,
                    domain: updated.domain,
                    system_prompt: updated.system_prompt,
                    version: updated.version,
                  }
                : r
            )
          );
        }}
      />
    </>
  );
}
