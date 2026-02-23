export type PendingApproval = {
  approval_id: string;
  task_id: string;
  title: string | null;
  requested_at: string;
};

export type ApprovalPreview = {
  approval_id: string;
  task_id: string;
  title: string;
  markdown: string;
  file_path: string;
  obsidian_url: string;
};

export async function fetchPendingApprovals(): Promise<PendingApproval[]> {
  const res = await fetch('/api/swarm/approvals?status=pending');
  if (!res.ok) throw new Error('Failed to load pending approvals');
  return res.json();
}

export async function findPendingApprovalId(taskId: string): Promise<string> {
  const rows = await fetchPendingApprovals();
  const row = rows.find((r) => r.task_id === taskId);
  if (!row?.approval_id) throw new Error('Pending approval not found for this task');
  return row.approval_id;
}

export async function fetchApprovalPreview(approvalId: string): Promise<ApprovalPreview> {
  const res = await fetch(`/api/swarm/approvals/${approvalId}/preview`);
  if (!res.ok) throw new Error('Failed to load approval preview');
  return res.json();
}

export async function approveApproval(approvalId: string, approver = 'human') {
  const res = await fetch(`/api/swarm/approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approver }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'Approve failed');
  }
  return res.json();
}

export async function rejectApproval(approvalId: string, note: string, reviewer = 'human') {
  const res = await fetch(`/api/swarm/approvals/${approvalId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewer, note }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'Reject failed');
  }
  return res.json();
}

export async function approveTaskById(taskId: string, approver = 'human') {
  const approvalId = await findPendingApprovalId(taskId);
  return approveApproval(approvalId, approver);
}

export async function rejectTaskById(taskId: string, note: string, reviewer = 'human') {
  const approvalId = await findPendingApprovalId(taskId);
  return rejectApproval(approvalId, note, reviewer);
}
