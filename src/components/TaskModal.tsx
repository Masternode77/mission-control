'use client';

import { useState, useCallback } from 'react';
import { X, Save, Trash2, Activity, Package, Bot, ClipboardList, CheckCircle2, XCircle } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { ActivityLog } from './ActivityLog';
import { DeliverablesList } from './DeliverablesList';
import { SessionsList } from './SessionsList';
import { PlanningTab } from './PlanningTab';
import type { Task, TaskPriority } from '@/lib/types';
import { SWARM_PIPELINE_COLUMNS, type SwarmPipelineStatus } from '@/lib/swarm-status';
import { approveTaskById, rejectTaskById } from '@/lib/swarm-approvals';

type TabType = 'overview' | 'planning' | 'activity' | 'deliverables' | 'sessions';

interface TaskModalProps {
  task?: Task;
  onClose: () => void;
  workspaceId?: string;
  onSaved?: () => void;
}

export function TaskModal({ task, onClose, workspaceId, onSaved }: TaskModalProps) {
  const { addTask, updateTask, addEvent } = useMissionControl();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usePlanningMode, setUsePlanningMode] = useState(false);
  const [hitlLoading, setHitlLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>(task?.status === 'planning' ? 'planning' : 'overview');

  const handleSpecLocked = useCallback(() => {
    window.location.reload();
  }, []);

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    priority: (task?.priority || 'normal') as TaskPriority,
    status: ((task?.status as SwarmPipelineStatus) || 'intake') as SwarmPipelineStatus,
    owner_role_id: 'MC-MAIN',
    due_date: task?.due_date || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const url = task ? `/api/swarm/tasks/${task.id}` : '/api/swarm/tasks';
      const method = task ? 'PATCH' : 'POST';

      const payload = {
        title: form.title,
        description: form.description,
        status: (!task && usePlanningMode) ? 'spec_drafting' : form.status,
        priority: form.priority,
        owner_role_id: 'MC-MAIN',
        due_date: form.due_date || null,
        workspace_id: workspaceId || task?.workspace_id || 'default',
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to save task (${res.status})`);
      }

      const savedTask = await res.json();

      if (task) {
        updateTask(savedTask);
      } else {
        addTask(savedTask);
        addEvent({
          id: crypto.randomUUID(),
          type: 'task_created',
          task_id: savedTask.id,
          message: `New task: ${savedTask.title}`,
          created_at: new Date().toISOString(),
        });
      }

      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Failed to save task:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!task || !confirm(`Delete "${task.title}"?`)) return;

    try {
      const res = await fetch(`/api/swarm/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        useMissionControl.setState((state) => ({
          tasks: state.tasks.filter((t) => t.id !== task.id),
        }));
        onClose();
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleApprove = async () => {
    if (!task) return;
    setHitlLoading(true);
    try {
      await approveTaskById(task.id, 'human');
      updateTask({ ...(task as any), status: 'completed' });
      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Failed to approve task:', error);
      alert(error instanceof Error ? error.message : 'Failed to approve task');
    } finally {
      setHitlLoading(false);
    }
  };

  const handleReject = async () => {
    if (!task) return;
    setHitlLoading(true);
    try {
      await rejectTaskById(task.id, 'HITL modal rejection: please revise and improve the markdown deliverable.', 'human');
      updateTask({ ...(task as any), status: 'in_execution' });
      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Failed to reject/rework task:', error);
      alert(error instanceof Error ? error.message : 'Failed to reject/rework task');
    } finally {
      setHitlLoading(false);
    }
  };

  const statuses: SwarmPipelineStatus[] = SWARM_PIPELINE_COLUMNS.map((c) => c.id);
  const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

  const isSwarmTask = !!task && ['intake', 'orchestrating', 'in_execution', 'hitl_review', 'completed'].includes(String(task.status));
  const isHITLReview = String(task?.status || '') === 'hitl_review';

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview', icon: null },
    ...(!isSwarmTask ? [{ id: 'planning' as TabType, label: 'Planning', icon: <ClipboardList className="w-4 h-4" /> }] : []),
    { id: 'activity' as TabType, label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'deliverables' as TabType, label: 'Deliverables', icon: <Package className="w-4 h-4" /> },
    { id: 'sessions' as TabType, label: 'Sessions', icon: <Bot className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-mc-border flex-shrink-0">
          <h2 className="text-lg font-semibold">{task ? task.title : 'Create New Task'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-mc-bg-tertiary rounded"><X className="w-5 h-5" /></button>
        </div>

        {task && (
          <div className="flex border-b border-mc-border flex-shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? 'text-mc-accent border-b-2 border-mc-accent' : 'text-mc-text-secondary hover:text-mc-text'}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'overview' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" placeholder="What needs to be done?" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent resize-none" placeholder="Add details..." />
              </div>

              {!task && (
                <div className="p-3 bg-mc-bg rounded-lg border border-mc-border">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={usePlanningMode} onChange={(e) => setUsePlanningMode(e.target.checked)} className="w-4 h-4 mt-0.5 rounded border-mc-border" />
                    <div>
                      <span className="font-medium text-sm flex items-center gap-2"><ClipboardList className="w-4 h-4 text-mc-accent" />Enable Planning Mode</span>
                      <p className="text-xs text-mc-text-secondary mt-1">Best for complex projects that need detailed requirements. You&apos;ll answer a few questions to define scope, goals, and constraints before work begins. Skip this for quick, straightforward tasks.</p>
                    </div>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SwarmPipelineStatus })} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
                    {statuses.map((s) => (<option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent">
                    {priorities.map((p) => (<option key={p} value={p}>{p.toUpperCase()}</option>))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Assign to</label>
                <input type="text" value="🧠 MC-MAIN (Monica · Chief of Staff)" readOnly className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm text-mc-text-secondary" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <input type="datetime-local" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent" />
              </div>
            </form>
          )}

          {activeTab === 'planning' && task && <PlanningTab taskId={task.id} onSpecLocked={handleSpecLocked} />}
          {activeTab === 'activity' && task && <ActivityLog taskId={task.id} />}

          {activeTab === 'deliverables' && task && (
            <>
              <DeliverablesList taskId={task.id} />
              {isHITLReview && (
                <div className="mt-4 p-4 rounded-lg border border-mc-border bg-mc-bg flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
                  <button type="button" onClick={() => void handleApprove()} disabled={hitlLoading} className="flex items-center justify-center gap-2 px-4 py-2 rounded font-medium text-sm bg-emerald-600/90 hover:bg-emerald-600 text-white disabled:opacity-50"><CheckCircle2 className="w-4 h-4" />✅ Approve (Complete)</button>
                  <button type="button" onClick={() => void handleReject()} disabled={hitlLoading} className="flex items-center justify-center gap-2 px-4 py-2 rounded font-medium text-sm bg-rose-600/90 hover:bg-rose-600 text-white disabled:opacity-50"><XCircle className="w-4 h-4" />❌ Reject (Rework)</button>
                </div>
              )}
            </>
          )}

          {activeTab === 'sessions' && task && <SessionsList taskId={task.id} />}
        </div>

        {activeTab === 'overview' && (
          <div className="flex items-center justify-between p-4 border-t border-mc-border flex-shrink-0">
            <div className="flex gap-2">
              {task && (
                <button type="button" onClick={handleDelete} className="flex items-center gap-2 px-3 py-2 text-mc-accent-red hover:bg-mc-accent-red/10 rounded text-sm"><Trash2 className="w-4 h-4" />Delete</button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-mc-text-secondary hover:text-mc-text">Cancel</button>
              <button onClick={handleSubmit} disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"><Save className="w-4 h-4" />{isSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
