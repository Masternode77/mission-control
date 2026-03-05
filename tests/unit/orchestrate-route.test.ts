import test from 'node:test';
import assert from 'node:assert/strict';

import { heuristicRoute } from '../../src/lib/swarm-routing';

test('routes venture/deploy tasks to web_venture_lead with explicit checklist and smoke validation instructions', () => {
  const decision = heuristicRoute('웹앱 MVP 배포 자동화', 'venture smoke route');

  assert.equal(decision.target_agent_id, 'web_venture_lead');
  assert.match(decision.sub_prompt, /plan→build→verify→deploy checklist/);
  assert.match(decision.sub_prompt, /explicit build, verify, and deploy checklist artifacts/i);
  assert.match(decision.sub_prompt, /Smoke validate \/workspace\/venture/i);
  assert.match(decision.sub_prompt, /strict STORIES_JSON fenced block/i);
  assert.match(decision.sub_prompt, /plaintext fallback plan/i);
});

test('routes macro tasks to shared_planner_architect', () => {
  const decision = heuristicRoute('FOMC 시나리오 분석', '금리/환율 민감도');

  assert.equal(decision.target_agent_id, 'shared_planner_architect');
});
