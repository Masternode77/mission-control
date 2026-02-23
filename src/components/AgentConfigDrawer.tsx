'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { DOMAIN_ENUM, DOMAIN_LABEL, ROLE_SPEC_V1_TEMPLATE, type AgentDomain } from '@/lib/agent-config';

export type RoleConfigModel = {
  role_id: string;
  display_name: string;
  domain: string;
  system_prompt: string;
  version: number;
};

type Props = {
  role: RoleConfigModel | null;
  onClose: () => void;
  onSaved?: (updated: RoleConfigModel) => void;
};

export function AgentConfigDrawer({ role, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const initial = useMemo(() => {
    if (!role) return null;
    return {
      displayName: role.display_name,
      domain: role.domain,
      systemPrompt: role.system_prompt?.trim() ? role.system_prompt : ROLE_SPEC_V1_TEMPLATE,
      version: role.version,
    };
  }, [role]);

  const [displayName, setDisplayName] = useState('');
  const [domain, setDomain] = useState('SHARED');
  const [systemPrompt, setSystemPrompt] = useState(ROLE_SPEC_V1_TEMPLATE);
  const [version, setVersion] = useState(1);

  useEffect(() => {
    if (!initial) return;
    setDisplayName(initial.displayName);
    setDomain(initial.domain);
    setSystemPrompt(initial.systemPrompt);
    setVersion(initial.version);
    setToast(null);
  }, [initial]);

  if (!role) return null;

  const hasDisplayNameError = displayName.trim().length < 2 || displayName.trim().length > 40;
  const hasPromptError = systemPrompt.trim().length < 50;
  const domainValid = DOMAIN_ENUM.includes(domain as AgentDomain);
  const isDirty =
    displayName.trim() !== (initial?.displayName || '').trim() ||
    domain !== (initial?.domain || '') ||
    systemPrompt.trim() !== (initial?.systemPrompt || '').trim();

  const canSave = !saving && isDirty && !hasDisplayNameError && !hasPromptError && domainValid;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/swarm/roles/${role.role_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          domain,
          systemPrompt: systemPrompt.trim(),
          baseVersion: version,
        }),
      });

      if (res.status === 409) {
        setToast('Data modified by another process. Please refresh.');
        const latest = await fetch('/api/swarm/roles').then((r) => r.json());
        const match = latest.find((x: any) => x.role_id === role.role_id);
        if (match) {
          setDisplayName(match.display_name);
          setDomain(match.domain);
          setSystemPrompt(match.system_prompt || ROLE_SPEC_V1_TEMPLATE);
          setVersion(match.version || 1);
          onSaved?.({
            role_id: match.role_id,
            display_name: match.display_name,
            domain: match.domain,
            system_prompt: match.system_prompt || '',
            version: match.version || 1,
          });
        }
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setToast(err.error || 'Failed to save');
        return;
      }

      const data = await res.json();
      const updated: RoleConfigModel = {
        role_id: role.role_id,
        display_name: data.displayName,
        domain: data.domain,
        system_prompt: data.systemPrompt,
        version: data.version,
      };
      setVersion(updated.version);
      onSaved?.(updated);
      setToast('Saved successfully');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] z-50 bg-mc-bg-secondary border-l border-mc-border shadow-2xl p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm uppercase tracking-wider text-cyan-300">Agent Configuration</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-mc-bg-tertiary"><X className="w-4 h-4" /></button>
      </div>

      {toast && <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{toast}</div>}

      <div className="space-y-4">
        <div>
          <label className="block text-xs mb-1 text-mc-text-secondary">Role ID</label>
          <input value={role.role_id} disabled className="w-full px-3 py-2 rounded bg-mc-bg border border-mc-border text-xs text-mc-text-secondary" />
        </div>

        <div>
          <label className="block text-xs mb-1 text-mc-text-secondary">Display Name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full px-3 py-2 rounded bg-mc-bg border border-mc-border text-sm" />
          {hasDisplayNameError && <div className="text-[11px] text-red-300 mt-1">Display Name must be 2~40 chars.</div>}
        </div>

        <div>
          <label className="block text-xs mb-1 text-mc-text-secondary">Domain</label>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className="w-full px-3 py-2 rounded bg-mc-bg border border-mc-border text-sm">
            {DOMAIN_ENUM.map((d) => (
              <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs mb-1 text-mc-text-secondary">System Prompt / Instructions</label>
          <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} className="w-full h-80 px-3 py-2 rounded bg-mc-bg border border-mc-border text-xs" />
          {hasPromptError && <div className="text-[11px] text-red-300 mt-1">System Prompt must be at least 50 chars.</div>}
        </div>

        <button onClick={save} disabled={!canSave} className="w-full px-3 py-2 rounded bg-cyan-500/20 text-cyan-300 text-sm disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
