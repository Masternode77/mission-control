import path from 'path';
import Database from 'better-sqlite3';
import { ROLE_SPEC_V1_TEMPLATE } from '../src/lib/agent-config';

type Domain = 'DATA_CENTER' | 'MACRO' | 'CRYPTO' | 'VENTURE' | 'SHARED';

type TargetRole = {
  role_id: string;
  display_name: string;
  domain: Domain;
};

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'mission-control.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const now = new Date().toISOString();

const TARGET_ROLES: TargetRole[] = [
  // Squad 1: DATA_CENTER (6)
  { role_id: 'dc_tech_financial_modeler', display_name: 'DC Financial Modeler (재무 모델링/WACC 산출)', domain: 'DATA_CENTER' },
  { role_id: 'dc_strategy_analyst', display_name: 'DC Colocation Strategist (글로벌 CSP 수요/입지 분석)', domain: 'DATA_CENTER' },
  { role_id: 'dc_planner', display_name: 'DC Power & Grid Negotiator (한전 전력 수급 및 인허가 리스크 전담)', domain: 'DATA_CENTER' },
  { role_id: 'dc_deep_researcher', display_name: 'DC Competitor Intel (타사 데이터센터 공급량/파이프라인 추적)', domain: 'DATA_CENTER' },
  { role_id: 'dc_writer', display_name: 'DC Pitch Deck Creator (MS, AWS 등 테넌트 대상 제안서 작성)', domain: 'DATA_CENTER' },
  { role_id: 'dc_editor', display_name: 'DC Feasibility Auditor (투자 심의용 타당성 보고서 검수)', domain: 'DATA_CENTER' },

  // Squad 2: MACRO (4)
  { role_id: 'shared_planner_architect', display_name: 'Chief Macro Strategist (연준 금리, 환율, 글로벌 매크로 지표 분석)', domain: 'MACRO' },
  { role_id: 'shared_writer', display_name: 'Real Estate Market Analyst (서울 주요 입지 부동산/아파트 가격 동향 추적)', domain: 'MACRO' },
  { role_id: 'shared_security_auditor', display_name: 'Asset Allocation Planner (총자산 대비 부채 비율 및 포트폴리오 리밸런싱)', domain: 'MACRO' },
  { role_id: 'shared_implementer_coder', display_name: 'Tax & Compliance Advisor (세무 및 규제 리스크 검토)', domain: 'MACRO' },

  // Squad 3: CRYPTO (4)
  { role_id: 'webapp_deep_researcher', display_name: 'BTC Dominance Tracker (비트코인 도미넌스 및 온체인 데이터 분석)', domain: 'CRYPTO' },
  { role_id: 'webapp_test_writer', display_name: 'Altcoin Risk Auditor (알트코인 내재 가치 및 토크노믹스 리스크 평가)', domain: 'CRYPTO' },
  { role_id: 'crypto_sentiment_analyst', display_name: 'Crypto Sentiment Analyst (X/트위터 및 시장 심리 지수 추적)', domain: 'CRYPTO' },
  { role_id: 'defi_yield_modeler', display_name: 'DeFi Yield Modeler (디파이 생태계 수익률 및 유동성 분석)', domain: 'CRYPTO' },

  // Squad 4: VENTURE (4)
  { role_id: 'webapp_implementer', display_name: 'Game Engine Architect (슈팅/디펜스 게임 로직 및 물리 엔진 설계)', domain: 'VENTURE' },
  { role_id: 'webapp_planner', display_name: 'Full-Stack Implementer (웹 서비스 코드 작성 및 디버깅)', domain: 'VENTURE' },
  { role_id: 'webapp_venture_builder', display_name: 'Venture Product Manager (토이 프로젝트 기획 및 백로그 관리)', domain: 'VENTURE' },
  { role_id: 'venture_qa_security_tester', display_name: 'QA & Security Tester (코드 취약점 분석 및 테스트 케이스 작성)', domain: 'VENTURE' },

  // Squad 5: SHARED / OPS (5)
  { role_id: 'MC-MAIN', display_name: 'Monica · Chief of Staff (최상위 라우팅 및 지휘 통제)', domain: 'SHARED' },
  { role_id: 'shared_editor_quality_gate', display_name: 'Final Quality Gate (모든 산출물 최종 검수 및 포맷팅)', domain: 'SHARED' },
  { role_id: 'shared_memory_curator', display_name: 'MOC Knowledge Curator (옵시디언 볼트 지식 구조화 및 태깅)', domain: 'SHARED' },
  { role_id: 'shared_deep_researcher_dwight', display_name: 'Global Fact Checker (모든 보고서의 통계/수치 크로스체크)', domain: 'SHARED' },
  { role_id: 'webapp_security_auditor', display_name: 'System Error Handler (플로우 중단 시 에러 복구 및 예외 처리)', domain: 'SHARED' },
];

function shouldInjectTemplate(current: string | null): boolean {
  const v = (current ?? '').trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  const genericSignals = ['generic', 'placeholder', 'lorem', 'tbd', 'todo', 'sample', 'dummy'];
  if (genericSignals.some((s) => lower.includes(s))) return true;
  if (v.length < 24) return true;
  return false;
}

type Existing = {
  role_id: string;
  display_name: string;
  domain: string;
  prompt_template_ref: string | null;
  profile_type: string;
  default_agent_id: string | null;
  output_schema_version: string | null;
  enabled: number;
  version: number;
};

const existingRows = db
  .prepare(
    `SELECT role_id, display_name, domain, prompt_template_ref, profile_type, default_agent_id, output_schema_version, enabled, version
     FROM agent_roles`,
  )
  .all() as Existing[];

const existingById = new Map(existingRows.map((r) => [r.role_id, r]));

const updateStmt = db.prepare(
  `UPDATE agent_roles
   SET display_name = ?,
       domain = ?,
       prompt_template_ref = ?,
       version = ?,
       updated_at = ?
   WHERE role_id = ?`,
);

const insertStmt = db.prepare(
  `INSERT INTO agent_roles (
    role_id, display_name, domain, profile_type, default_agent_id, prompt_template_ref,
    output_schema_version, enabled, created_at, updated_at, version
  ) VALUES (?, ?, ?, 'prompt', NULL, ?, NULL, 1, ?, ?, 1)`,
);

let updated = 0;
let inserted = 0;
let promptInjected = 0;
const createdIds: string[] = [];

const tx = db.transaction(() => {
  for (const target of TARGET_ROLES) {
    const existing = existingById.get(target.role_id);
    if (!existing) {
      insertStmt.run(target.role_id, target.display_name, target.domain, ROLE_SPEC_V1_TEMPLATE, now, now);
      inserted += 1;
      promptInjected += 1;
      createdIds.push(target.role_id);
      continue;
    }

    const inject = shouldInjectTemplate(existing.prompt_template_ref);
    const nextPrompt = inject ? ROLE_SPEC_V1_TEMPLATE : existing.prompt_template_ref;
    if (inject) promptInjected += 1;

    updateStmt.run(target.display_name, target.domain, nextPrompt, (existing.version ?? 1) + 1, now, target.role_id);
    updated += 1;
  }
});

tx();

const finalRows = db
  .prepare('SELECT role_id, display_name, domain, version FROM agent_roles ORDER BY domain, role_id')
  .all() as Array<{ role_id: string; display_name: string; domain: string; version: number }>;

const targetSet = new Set(TARGET_ROLES.map((r) => r.role_id));
const outOfMatrix = finalRows.filter((r) => !targetSet.has(r.role_id));
const missing = TARGET_ROLES.filter((r) => !finalRows.some((x) => x.role_id === r.role_id));

const domainCounts = db
  .prepare(
    `SELECT domain, COUNT(*) AS count
     FROM agent_roles
     WHERE role_id IN (${TARGET_ROLES.map(() => '?').join(',')})
     GROUP BY domain
     ORDER BY domain`,
  )
  .all(...TARGET_ROLES.map((r) => r.role_id)) as Array<{ domain: string; count: number }>;

console.log('=== apply-master-taxonomy ===');
console.log(`dbPath=${dbPath}`);
console.log(`updated=${updated} inserted=${inserted} promptInjected=${promptInjected}`);
if (createdIds.length) console.log(`createdRoleIds=${createdIds.join(', ')}`);
console.log('domainCounts (target set only):');
console.table(domainCounts);
console.log(`targetRoles=${TARGET_ROLES.length} missing=${missing.length} outOfMatrix=${outOfMatrix.length}`);
if (missing.length) console.table(missing);
if (outOfMatrix.length) {
  console.log('outOfMatrix role_ids (not deleted):');
  console.table(outOfMatrix.map((r) => ({ role_id: r.role_id, domain: r.domain, display_name: r.display_name })));
}

db.close();
