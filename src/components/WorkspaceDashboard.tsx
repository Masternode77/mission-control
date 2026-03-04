'use client';

import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Folder, Users, CheckSquare, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { WorkspaceStats } from '@/lib/types';

export function WorkspaceDashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [targetTopic, setTargetTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadWorkspaces();
    loadReports();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch('/api/workspaces?stats=true');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    }
  };

  const retryReport = async (id: string, step: 'send' | 'index' | 'pdf' | 'all') => {
    await fetch(`/api/reports/${id}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    });
    await loadReports();
  };

  const generateResearchReport = async () => {
    if (!targetTopic.trim()) return;
    setGenerating(true);
    setGenerateStatus('in_execution');
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: targetTopic.trim() }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setGenerateStatus('completed');
        setTargetTopic('');
        await loadReports();
      } else {
        setGenerateStatus(`failed: ${data?.error || 'unknown'}`);
      }
    } catch (e: any) {
      setGenerateStatus(`failed: ${String(e?.message || e)}`);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-bg">
      {/* Header */}
      <header className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🦞</span>
              <h1 className="text-xl font-bold">Mission Control</h1>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
            >
              <Plus className="w-4 h-4" />
              New Workspace
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">All Workspaces</h2>
          <p className="text-mc-text-secondary">
            Select a workspace to view its mission queue and agents
          </p>
        </div>

        <section className="mb-10 bg-mc-bg-secondary border border-mc-border rounded-xl p-4">
          <div className="flex flex-col gap-3 mb-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Recent Reports (3-way sync)</h3>
              <button onClick={loadReports} className="text-xs px-2 py-1 border border-mc-border rounded hover:border-mc-accent">Refresh</button>
            </div>
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
              <input
                value={targetTopic}
                onChange={(e) => setTargetTopic(e.target.value)}
                placeholder="Target Topic/URL (e.g., Meta APAC DC Expansion)"
                className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
              />
              <button
                onClick={generateResearchReport}
                disabled={generating || !targetTopic.trim()}
                className="px-3 py-2 rounded bg-cyan-500/20 text-cyan-200 text-sm disabled:opacity-50"
              >
                {generating ? 'Generating... (in_execution)' : 'Generate Research Report'}
              </button>
            </div>
            {generateStatus && <div className="text-xs text-mc-text-secondary">Status: {generateStatus}</div>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mc-text-secondary border-b border-mc-border">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Deliverables</th>
                  <th className="py-2 pr-3">Distribution</th>
                  <th className="py-2 pr-3">Index Status</th>
                  <th className="py-2 pr-3">PDF Export</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-mc-border/40">
                    <td className="py-2 pr-3">{r.title}</td>
                    <td className="py-2 pr-3 text-xs break-all">{r.file_path}</td>
                    <td className="py-2 pr-3">{r.telegram_status}</td>
                    <td className="py-2 pr-3">{r.index_status}</td>
                    <td className="py-2 pr-3">{r.pdf_status || 'pending'}</td>
                    <td className="py-2">
                      {(r.telegram_status === 'failed' || r.index_status === 'failed' || r.pdf_status === 'failed') ? (
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => retryReport(r.id, 'send')} className="text-xs px-2 py-1 rounded bg-amber-500/20">Retry Send</button>
                          <button onClick={() => retryReport(r.id, 'index')} className="text-xs px-2 py-1 rounded bg-cyan-500/20">Retry Index</button>
                          <button onClick={() => retryReport(r.id, 'pdf')} className="text-xs px-2 py-1 rounded bg-violet-500/20">Retry PDF</button>
                          <button onClick={() => retryReport(r.id, 'all')} className="text-xs px-2 py-1 rounded bg-emerald-500/20 flex items-center gap-1"><RefreshCw className="w-3 h-3"/>Retry All</button>
                        </div>
                      ) : (
                        <span className="text-xs text-mc-text-secondary">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr><td className="py-3 text-mc-text-secondary" colSpan={6}>No reports yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {workspaces.length === 0 ? (
          <div className="text-center py-16">
            <Folder className="w-16 h-16 mx-auto text-mc-text-secondary mb-4" />
            <h3 className="text-lg font-medium mb-2">No workspaces yet</h3>
            <p className="text-mc-text-secondary mb-6">
              Create your first workspace to get started
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
            >
              Create Workspace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workspaces.map((workspace) => (
              <WorkspaceCard 
                key={workspace.id} 
                workspace={workspace} 
                onDelete={(id) => setWorkspaces(workspaces.filter(w => w.id !== id))}
              />
            ))}
            
            {/* Add workspace card */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="border-2 border-dashed border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-colors flex flex-col items-center justify-center gap-3 min-h-[200px]"
            >
              <div className="w-12 h-12 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                <Plus className="w-6 h-6 text-mc-text-secondary" />
              </div>
              <span className="text-mc-text-secondary font-medium">Add Workspace</span>
            </button>
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateWorkspaceModal 
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, onDelete }: { workspace: WorkspaceStats; onDelete: (id: string) => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDelete(workspace.id);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete workspace');
      }
    } catch {
      alert('Failed to delete workspace');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };
  
  return (
    <>
    <Link href={`/workspace/${workspace.slug}`}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-all hover:shadow-lg cursor-pointer group relative">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{workspace.icon}</span>
            <div>
              <h3 className="font-semibold text-lg group-hover:text-mc-accent transition-colors">
                {workspace.name}
              </h3>
              <p className="text-sm text-mc-text-secondary">/{workspace.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {workspace.id !== 'default' && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="p-1.5 rounded hover:bg-mc-accent-red/20 text-mc-text-secondary hover:text-mc-accent-red transition-colors opacity-0 group-hover:opacity-100"
                title="Delete workspace"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <ArrowRight className="w-5 h-5 text-mc-text-secondary group-hover:text-mc-accent transition-colors" />
          </div>
        </div>

        {/* Simple task/agent counts */}
        <div className="flex items-center gap-4 text-sm text-mc-text-secondary mt-4">
          <div className="flex items-center gap-1">
            <CheckSquare className="w-4 h-4" />
            <span>{workspace.taskCounts.total} tasks</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            <span>{workspace.agentCount} agents</span>
          </div>
        </div>
      </div>
    </Link>

    {/* Delete Confirmation Modal */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(false)}>
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-mc-accent-red/20 rounded-full">
              <AlertTriangle className="w-6 h-6 text-mc-accent-red" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Delete Workspace</h3>
              <p className="text-sm text-mc-text-secondary">This action cannot be undone</p>
            </div>
          </div>
          
          <p className="text-mc-text-secondary mb-6">
            Are you sure you want to delete <strong>{workspace.name}</strong>? 
            {workspace.taskCounts.total > 0 && (
              <span className="block mt-2 text-mc-accent-red">
                ⚠️ This workspace has {workspace.taskCounts.total} task(s). Delete them first.
              </span>
            )}
          </p>
          
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || workspace.taskCounts.total > 0 || workspace.agentCount > 0}
              className="px-4 py-2 bg-mc-accent-red text-white rounded-lg font-medium hover:bg-mc-accent-red/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete Workspace'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icons = ['📁', '💼', '🏢', '🚀', '💡', '🎯', '📊', '🔧', '🌟', '🏠'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon }),
      });

      if (res.ok) {
        onCreated();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create workspace');
      }
    } catch {
      setError('Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-md">
        <div className="p-6 border-b border-mc-border">
          <h2 className="text-lg font-semibold">Create New Workspace</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Icon selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Icon</label>
            <div className="flex flex-wrap gap-2">
              {icons.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                    icon === i 
                      ? 'bg-mc-accent/20 border-2 border-mc-accent' 
                      : 'bg-mc-bg border border-mc-border hover:border-mc-accent/50'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-mc-accent-red text-sm">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
