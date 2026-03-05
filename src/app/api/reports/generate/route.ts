import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { createReportPipeline } from '@/lib/reporting';
import { run } from '@/lib/db';

function buildReport(topic: string, snippets: string[]) {
  return `# ${topic} — Research Report\n\n## 1. Executive Summary\n- ${topic} 관련 핵심 시사점 1: 인프라/투자 규모 확대 가능성\n- 핵심 시사점 2: 지역별 규제·전력·네트워크 조건이 의사결정 축\n- 핵심 시사점 3: 실행 전략은 단계 증설 + 위험 분산형이 유효\n\n## 2. CAPEX & Timeline\n- 단기(12개월): 투자 방향성 및 우선순위 확정\n- 중기(24~36개월): 지역별 실행/증설\n- 장기(2030): 운영 효율과 수익성 최적화\n\n## 3. Infrastructure Specs\n- 전력: 고밀도 랙 대응 가능한 단계별 전력 확장 모델 필요\n- 냉각: 공랭 기반 + liquid-cooling 전환 가능한 하이브리드 설계 권장\n- 네트워크: 국제/해저케이블 연계성 기반 저지연 구조 확보\n\n## 4. Strategic Implications for ADIK\n- AI-ready 코로케이션 오퍼(전력/냉각/납기/SLA)를 표준화해 선제 제안\n- 고객 의사결정 속도를 높이기 위해 상업조건(MRC/NRC/옵션) 패키지화\n- 국가별 전력/인허가/RE 조달 리스크 매트릭스 기반 우선순위 영업\n\n## Research Notes\n${snippets.map((s, i) => `- Source ${i + 1}: ${s}`).join('\n')}\n`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic = String(body?.topic || '').trim();
    if (!topic) return NextResponse.json({ ok: false, error: 'topic_required' }, { status: 400 });

    const now = new Date().toISOString();
    const taskId = uuidv4();

    run(
      `INSERT INTO swarm_tasks (task_id, ws, title, objective, owner_role_id, priority, status, origin_type, created_by, created_at, updated_at)
       VALUES (?, 'default', ?, ?, 'MC-MAIN', 'P2', 'in_execution', 'topdown', 'report-generate-api', ?, ?)`,
      [taskId, `Research Report: ${topic}`, topic, now, now]
    );

    const snippets: string[] = [];
    try {
      const r = await fetch(`https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(topic)}`);
      if (r.ok) {
        const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 500);
        snippets.push(t || topic);
      }
    } catch {
      snippets.push(`Live web fetch unavailable for ${topic}; generated from internal template.`);
    }

    const content = buildReport(topic, snippets.length ? snippets : [`Template-based synthesis for ${topic}`]);
    const report = await createReportPipeline({
      title: `${topic} — Auto Research Report`,
      content,
      taskId,
      workspaceId: 'default',
      telegramChatId: process.env.TELEGRAM_MASTER_CHAT_ID,
    });

    run(`UPDATE swarm_tasks SET status='completed', updated_at=? WHERE task_id=?`, [new Date().toISOString(), taskId]);

    return NextResponse.json({ ok: true, taskId, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
