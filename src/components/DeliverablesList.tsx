'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Eye } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type SwarmDeliverable = {
  id: string;
  title: string;
  path: string | null;
  description: string | null;
  created_at: string;
  deliverable_type: 'file' | 'artifact' | 'url';
};

interface DeliverablesListProps {
  taskId: string;
}

export function DeliverablesList({ taskId }: DeliverablesListProps) {
  const [deliverables, setDeliverables] = useState<SwarmDeliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);

  const loadDeliverables = useCallback(async () => {
    try {
      const res = await fetch(`/api/swarm/tasks/${taskId}/deliverables`);
      if (res.ok) {
        const data = await res.json();
        setDeliverables(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load swarm deliverables:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadDeliverables();
  }, [loadDeliverables]);

  const openPreview = async (d: SwarmDeliverable) => {
    try {
      const res = await fetch(`/api/swarm/tasks/${taskId}/deliverables/${d.id}/content`);
      if (!res.ok) return;
      const data = await res.json();
      setPreview({ title: d.title, content: data.content || '_No content_' });
    } catch (error) {
      console.error('Failed to preview deliverable:', error);
    }
  };

  if (loading) return <div className="py-8 text-center text-mc-text-secondary">Loading deliverables...</div>;
  if (!deliverables.length) return <div className="py-8 text-center text-mc-text-secondary">No deliverables yet</div>;

  return (
    <>
      <div className="space-y-3">
        {deliverables.map((d) => (
          <div key={d.id} className="flex gap-3 p-3 bg-mc-bg rounded-lg border border-mc-border">
            <FileText className="w-5 h-5 text-mc-accent mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-sm text-mc-text truncate">{d.title}</div>
                <button
                  onClick={() => void openPreview(d)}
                  className="p-1.5 rounded hover:bg-mc-bg-tertiary text-cyan-300"
                  title="Quick Look"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              {d.description && <div className="text-xs text-mc-text-secondary mt-1 line-clamp-2">{d.description}</div>}
              {d.path && <div className="text-[11px] font-mono text-mc-text-secondary mt-2 break-all">{d.path}</div>}
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-mc-border bg-mc-bg-secondary" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-mc-border flex items-center justify-between">
              <div className="text-sm font-semibold">{preview.title}</div>
              <button onClick={() => setPreview(null)} className="text-xs px-2 py-1 rounded bg-mc-bg-tertiary">Close</button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[70vh] prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{preview.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
