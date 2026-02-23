'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useGlobalSSE } from '@/providers/SSEProvider';
import {
  approveApproval,
  fetchApprovalPreview,
  fetchPendingApprovals,
  rejectApproval,
  type ApprovalPreview,
  type PendingApproval,
} from '@/lib/swarm-approvals';

type Props = {
  pendingApprovals: number;
};

export function HITLZone({ pendingApprovals }: Props) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [pulse, setPulse] = useState(false);
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sequence, lastEvent } = useGlobalSSE();

  const alert = pendingApprovals > 0 || items.length > 0;

  const loadPending = async () => {
    try {
      setItems(await fetchPendingApprovals());
    } catch (error) {
      console.error('Failed to load pending approvals:', error);
    }
  };

  useEffect(() => {
    void loadPending();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lastEvent) return;

    const shouldReload =
      lastEvent.type === 'event_logged' ||
      (lastEvent.type === 'task_updated') ||
      (lastEvent.type === 'task_created');

    if (!shouldReload) return;

    setPulse(true);
    setTimeout(() => setPulse(false), 1600);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadPending();
    }, 700);
  }, [sequence, lastEvent]);

  const pendingCount = useMemo(() => Math.max(pendingApprovals, items.length), [pendingApprovals, items.length]);

  const onApprove = async (approvalId: string) => {
    await approveApproval(approvalId, 'Josh');
    setPreview(null);
    setRejectMode(false);
    setRevisionNote('');
    void loadPending();
  };

  const onReview = async (approvalId: string) => {
    try {
      setPreview(await fetchApprovalPreview(approvalId));
      setRejectMode(false);
      setRevisionNote('');
    } catch (error) {
      console.error(error);
    }
  };

  const onConfirmReject = async () => {
    if (!preview || !revisionNote.trim()) return;
    await rejectApproval(preview.approval_id, revisionNote.trim(), 'Josh');
    setPreview(null);
    setRejectMode(false);
    setRevisionNote('');
    void loadPending();
  };

  return (
    <>
      <aside className={`rounded-xl border p-4 ${alert || pulse ? 'hitl-pulse-border border-amber-500/60' : 'border-mc-border'}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm tracking-wide">HITL Zone</h3>
          <span className={`text-xs px-2 py-0.5 rounded ${alert ? 'bg-amber-500/20 text-amber-300 animate-pulse' : 'bg-mc-bg-tertiary text-mc-text-secondary'}`}>
            {pendingCount} pending
          </span>
        </div>

        <p className="text-xs text-mc-text-secondary mb-3">awaiting-human-action 승인 대기열</p>

        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="text-xs text-mc-text-secondary">No pending approvals</div>
          ) : (
            items.slice(0, 3).map((item) => (
              <div key={item.approval_id} className="rounded border border-amber-500/30 p-2">
                <div className="text-xs font-medium truncate">{item.title || item.task_id}</div>
                <div className="text-[10px] text-mc-text-secondary mb-2">{item.task_id}</div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => onReview(item.approval_id)} className="px-2 py-1.5 rounded bg-cyan-500/20 text-cyan-300 text-xs">Review</button>
                  <button onClick={() => onApprove(item.approval_id)} className="px-2 py-1.5 rounded bg-emerald-500/20 text-emerald-300 text-xs">Approve</button>
                  <button onClick={() => onReview(item.approval_id)} className="px-2 py-1.5 rounded bg-mc-accent-red/20 text-mc-accent-red text-xs">Reject</button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {preview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-mc-border bg-mc-bg-secondary" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 border-b border-mc-border flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{preview.title}</div>
                <div className="text-xs text-mc-text-secondary">{preview.task_id}</div>
              </div>
              <div className="flex items-center gap-2">
                <a href={preview.obsidian_url} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-300">Open in Obsidian</a>
                <button onClick={() => window.print()} className="text-xs px-2 py-1 rounded bg-slate-500/20 text-slate-200">PDF</button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto max-h-[56vh] prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{preview.markdown}</ReactMarkdown>
            </div>

            {rejectMode && (
              <div className="px-5 pb-3">
                <label className="text-xs text-amber-300 mb-1 block">Revision Note (반려 사유)</label>
                <textarea
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder="수정 방향과 기대 산출물을 구체적으로 입력하세요"
                  className="w-full h-24 rounded border border-amber-500/40 bg-mc-bg p-2 text-xs"
                />
              </div>
            )}

            <div className="p-3 border-t border-mc-border flex justify-end gap-2">
              {!rejectMode ? (
                <>
                  <button onClick={() => setRejectMode(true)} className="px-3 py-2 rounded bg-mc-accent-red/20 text-mc-accent-red text-xs">Reject</button>
                  <button onClick={() => onApprove(preview.approval_id)} className="px-3 py-2 rounded bg-emerald-500/20 text-emerald-300 text-xs">Approve</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setRejectMode(false); setRevisionNote(''); }} className="px-3 py-2 rounded bg-slate-500/20 text-slate-200 text-xs">Cancel</button>
                  <button onClick={onConfirmReject} disabled={!revisionNote.trim()} className="px-3 py-2 rounded bg-amber-500/20 text-amber-300 text-xs disabled:opacity-50">Confirm Reject</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
