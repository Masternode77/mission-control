import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from '@/lib/events';
import { queryOne, run } from '@/lib/db';
import { buildHitlTelegramSummary, sendTelegramMessage } from '@/lib/telegram';
import { getRevisionInjection } from '@/lib/revision-injection';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const now = new Date().toISOString();

    const task = queryOne<{ task_id: string; title: string; objective: string | null }>(
      'SELECT task_id, title, objective FROM swarm_tasks WHERE task_id = ?',
      [id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const injection = getRevisionInjection(id);

    const checklistMd = `## Feedback Applied Checklist
1. 전력 시나리오별 민감도 표(기준/낙관/비관)와 변수 정의를 추가했습니다.
2. 규제 변수 리스크를 분리해 확률/영향도/완화전략을 독립 섹션으로 재구성했습니다.
3. 대안 시나리오(규제 완화/지연)에 따른 CAPEX·IRR 민감도를 비교표로 보완했습니다.

## Revised Power Sensitivity Analysis
- 목표: 수도권 전력 수급 제한 환경에서 프로젝트 수익성 방어
- 핵심 가정: 전력단가, 접속 리드타임, 인허가 지연확률

### Scenario Matrix
| Scenario | Power Availability | Schedule Impact | IRR Delta |
|---|---:|---:|---:|
| Base | 100% | 0개월 | 0.0%p |
| Stress-1 | 85% | +3개월 | -1.8%p |
| Stress-2 | 70% | +6개월 | -3.4%p |

### Risk / Alternative
- **Risk:** 규제 강화로 인한 전력 인입 지연 가능성
- **Alternative A:** 단계적 증설 + 선투자 분할 집행
- **Alternative B:** 타 권역 보조 전력 옵션 확보(백업 계약)
`;

    const finalDraft = injection.isRework
      ? `${injection.injectedPrefix}${checklistMd}`
      : checklistMd;

    // Mark latest running run completed and append revised draft as a completed run
    run(
      `UPDATE swarm_runs SET run_status = 'completed', ended_at = ?, output_summary = ?
       WHERE task_id = ? AND run_status = 'running'`,
      [now, finalDraft, id]
    );
    run(
      `INSERT INTO swarm_runs (run_id, task_id, role_id, run_status, started_at, ended_at, output_summary, created_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [uuidv4(), id, 'dc_tech_financial_modeler', now, now, finalDraft, now]
    );

    run('UPDATE swarm_tasks SET status = ?, updated_at = ? WHERE task_id = ?', ['hitl_review', now, id]);

    const existingPending = queryOne<{ approval_id: string }>(
      'SELECT approval_id FROM swarm_approvals WHERE task_id = ? AND approval_status = ? ORDER BY requested_at DESC LIMIT 1',
      [id, 'pending']
    );

    const approvalId = existingPending?.approval_id || uuidv4();
    if (!existingPending) {
      run(
        `INSERT INTO swarm_approvals (approval_id, task_id, gate_reason, approval_status, requested_at)
         VALUES (?, ?, ?, 'pending', ?)` ,
        [approvalId, id, 'Awaiting human review after agent completion', now]
      );
    }

    run(
      `INSERT INTO events (id, type, task_id, message, created_at)
       VALUES (?, 'task_status_changed', NULL, ?, ?)`,
      [uuidv4(), `[HITL] ${task.task_id}: ${task.title} moved to HITL_REVIEW`, now]
    );

    await sendTelegramMessage({
      text: buildHitlTelegramSummary(id, task.title, finalDraft || `Task ${id} moved to HITL_REVIEW`),
    });

    broadcast({ type: 'event_logged', payload: { taskId: id, sessionId: approvalId, summary: 'hitl_pending' } });

    return NextResponse.json({ ok: true, task_id: id, status: 'hitl_review', approval_id: approvalId, draft_preview: finalDraft.slice(0, 280) });
  } catch (error) {
    console.error('Failed to simulate completion:', error);
    return NextResponse.json({ error: 'Failed to simulate completion' }, { status: 500 });
  }
}
