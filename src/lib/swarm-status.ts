export const SWARM_PIPELINE_COLUMNS = [
  {
    id: 'intake',
    label: 'INTAKE',
    subtitle: '접수 및 대기',
    color: 'border-t-mc-accent-pink',
  },
  {
    id: 'orchestrating',
    label: 'ORCHESTRATING',
    subtitle: '라우팅 및 기획',
    color: 'border-t-mc-accent-yellow',
  },
  {
    id: 'in_execution',
    label: 'IN_EXECUTION',
    subtitle: '에이전트 실행 중',
    color: 'border-t-mc-accent',
  },
  {
    id: 'hitl_review',
    label: 'HITL_REVIEW',
    subtitle: '인간 및 품질 검토',
    color: 'border-t-mc-accent-cyan',
  },
  {
    id: 'completed',
    label: 'COMPLETED',
    subtitle: '완료 및 자산화',
    color: 'border-t-mc-accent-green',
  },
] as const;

export type SwarmPipelineStatus = (typeof SWARM_PIPELINE_COLUMNS)[number]['id'];

const LEGACY_TO_PIPELINE: Record<string, SwarmPipelineStatus> = {
  // Universal statuses
  intake: 'intake',
  orchestrating: 'orchestrating',
  in_execution: 'in_execution',
  hitl_review: 'hitl_review',
  completed: 'completed',

  // Old generic statuses
  queued: 'intake',
  new: 'intake',
  pending: 'intake',
  pending_dispatch: 'intake',
  todo: 'intake',
  inbox: 'intake',
  planning: 'orchestrating',
  assigned: 'orchestrating',
  site_selection: 'orchestrating',

  in_progress: 'in_execution',
  running: 'in_execution',
  executing: 'in_execution',
  active: 'in_execution',
  power_negotiation: 'in_execution',
  financial_modeling: 'in_execution',

  testing: 'hitl_review',
  qa: 'hitl_review',
  review: 'hitl_review',
  awaiting_approval: 'hitl_review',
  pending_approval: 'hitl_review',
  pitching_review: 'hitl_review',

  done: 'completed',
  accepted: 'completed',
  resolved: 'completed',
};

export function normalizeSwarmPipelineStatus(status: string | null | undefined): SwarmPipelineStatus {
  if (!status) return 'intake';
  return LEGACY_TO_PIPELINE[status.toLowerCase()] ?? 'intake';
}
