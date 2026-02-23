import { queryOne } from '@/lib/db';

export type RevisionInjection = {
  isRework: boolean;
  revisionNote?: string;
  injectedPrefix: string;
};

export function getRevisionInjection(taskId: string): RevisionInjection {
  const row = queryOne<{ decision_note: string | null }>(
    `SELECT decision_note
     FROM swarm_approvals
     WHERE task_id = ? AND approval_status = 'rejected'
     ORDER BY decided_at DESC
     LIMIT 1`,
    [taskId]
  );

  const note = (row?.decision_note || '').trim();
  if (!note) {
    return { isRework: false, injectedPrefix: '' };
  }

  const injectedPrefix = `[Supervisor Revision Note]: ${note}\n- You MUST strictly apply this feedback to your revised output.\n\n[Output Format - REQUIRED]\nYour final markdown MUST start with:\n## Feedback Applied Checklist\n1. <what you changed for feedback item #1>\n2. <what you changed for feedback item #2>\n3. <what you changed for feedback item #3>\n\nThen continue with the revised analysis.\n\n`;
  return { isRework: true, revisionNote: note, injectedPrefix };
}

export function applyRevisionInjection(taskId: string, basePrompt: string): { prompt: string; injection: RevisionInjection } {
  const injection = getRevisionInjection(taskId);
  return {
    prompt: `${injection.injectedPrefix}${basePrompt}`,
    injection,
  };
}
