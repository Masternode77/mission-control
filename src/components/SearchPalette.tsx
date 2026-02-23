'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type SearchResult = {
  task_id: string;
  title: string;
  description?: string | null;
  status: string;
  updated_at: string;
  matched_by: string;
  snippet?: string;
};

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  workspaceId?: string;
}

export function SearchPalette({ open, onClose, workspaceId }: SearchPaletteProps) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const ws = workspaceId || 'default';
        const res = await fetch(`/api/swarm/search?q=${encodeURIComponent(q)}&workspace_id=${encodeURIComponent(ws)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(Array.isArray(data) ? data : []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(t);
  }, [q, open, workspaceId]);

  const hint = useMemo(() => (navigator?.platform?.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl+K'), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-3xl bg-mc-bg-secondary border border-mc-border rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-3 border-b border-mc-border flex items-center gap-2">
          <Search className="w-4 h-4 text-mc-text-secondary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, descriptions, deliverables..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <span className="text-[11px] text-mc-text-secondary border border-mc-border rounded px-1.5 py-0.5">{hint}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-mc-bg-tertiary"><X className="w-4 h-4" /></button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-2">
          {loading && <div className="p-3 text-sm text-mc-text-secondary">Searching…</div>}
          {!loading && q.trim() && results.length === 0 && <div className="p-3 text-sm text-mc-text-secondary">No results</div>}
          {!q.trim() && <div className="p-3 text-sm text-mc-text-secondary">Type to search across title/description/deliverables</div>}

          {results.map((r) => (
            <button
              key={r.task_id}
              className="w-full text-left p-3 rounded-lg border border-mc-border hover:border-cyan-400/60 hover:bg-mc-bg"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('mc:open-task', { detail: { taskId: r.task_id } }));
                onClose();
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm truncate">{r.title}</div>
                <span className="text-[10px] uppercase text-cyan-300">{r.matched_by}</span>
              </div>
              {r.snippet && <div className="text-xs text-mc-text-secondary mt-1 line-clamp-2">{r.snippet}</div>}
              <div className="text-[11px] text-mc-text-secondary mt-1">
                {r.status} · {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
