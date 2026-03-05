export type RouteDecision = {
  target_agent_id: string;
  sub_prompt: string;
};

export function heuristicRoute(title: string, objective: string | null): RouteDecision {
  const text = `${title}\n${objective || ''}`.toLowerCase();

  if (/cpi|fomc|inflation|macro|금리|환율|거시/.test(text)) {
    return {
      target_agent_id: 'shared_planner_architect',
      sub_prompt: `Analyze this macro task with scenario framework and execution checklist.\nTask: ${title}\nObjective: ${objective || '-'}`,
    };
  }

  if (/venture|web app|webapp|앱|서비스|mvp|랜딩페이지|배포|deploy|product|saas/.test(text)) {
    return {
      target_agent_id: 'web_venture_lead',
      sub_prompt:
        `Design and execute a one-pass venture build plan (plan→build→verify→deploy checklist).\n` +
        `Task: ${title}\n` +
        `Objective: ${objective || '-'}\n` +
        `Requirements:\n` +
        `- Include explicit build, verify, and deploy checklist artifacts (filenames + command outputs).\n` +
        `- Smoke validate /workspace/venture route/endpoints and report pass/fail evidence.\n` +
        `- Output planning results in a strict STORIES_JSON fenced block so downstream steps can parse it.\n` +
        `- If STORIES_JSON cannot be produced, include a plaintext fallback plan and continue execution without crashing.`,
    };
  }

  if (/pricing|competitor|supply|pipeline|rfp/.test(text)) {
    return {
      target_agent_id: 'dc_deep_researcher',
      sub_prompt: `Produce competitor/supply intelligence and decision-grade summary.\nTask: ${title}\nObjective: ${objective || '-'}`,
    };
  }

  return {
    target_agent_id: 'dc_strategy_analyst',
    sub_prompt: `Create strategy brief with risks, options, and next actions.\nTask: ${title}\nObjective: ${objective || '-'}`,
  };
}
