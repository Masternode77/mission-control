'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SwarmTopologyPayload } from '@/hooks/useSwarmTopology';
import { PacketEdge } from './PacketEdge';

type Props = {
  topology: SwarmTopologyPayload;
  onNodeSelect?: (node: Node | null) => void;
};

const edgeTypes = { packet: PacketEdge };
const ORCH_W = 320;
const ORCH_H = 120;
const ROLE_W = 290;
const ROLE_H = 122;
const GROUP_PADDING = 24;
const GROUP_MIN_W = 360;
const LAYOUT_KEY = 'mc_topology_layout';

function groupId(domain?: string) {
  return `group:${(domain || 'Shared').trim()}`;
}

function runningNodeCount(topology: SwarmTopologyPayload): number {
  return topology.nodes.filter((n) => Number(n.metrics?.running_runs || 0) > 0).length;
}

function shouldGlobalZeroOverride(topology: SwarmTopologyPayload): boolean {
  const activeRuns = Number(topology?.stats?.active_runs || 0);
  const inExecutionNodes = runningNodeCount(topology);
  return activeRuns === 0 && inExecutionNodes === 0;
}

function hasAnyActiveExecution(topology: SwarmTopologyPayload): boolean {
  if (shouldGlobalZeroOverride(topology)) return false;
  if (Number(topology?.stats?.active_runs || 0) > 0) return true;
  return topology.nodes.some((n) => Number(n.metrics?.running_runs || 0) > 0);
}

function edgeLabel(handoffType: string, count: number) {
  const t = String(handoffType || '').toLowerCase();
  if (t === 'rework') return `🔁 rework · ${count}`;
  if (t === 'proactive') return `⚡ proactive · ${count}`;
  if (t === 'review') return `👀 review · ${count}`;
  return `↔ ${handoffType} · ${count}`;
}

function buildEdges(topology: SwarmTopologyPayload): Edge[] {
  const links = topology.links.length
    ? topology.links
    : topology.nodes
        .filter((n) => n.type !== 'orchestrator')
        .map((n) => ({
          id: `seed-${n.id}`,
          source: 'orchestrator:main',
          target: n.id,
          handoff_type: 'proactive',
          handoff_count: 1,
        }));

  const runningNodeIds = new Set(
    topology.nodes
      .filter((n) => (n.metrics?.running_runs || 0) > 0)
      .map((n) => n.id)
  );

  const activeExecution = hasAnyActiveExecution(topology);
  const zeroOverride = shouldGlobalZeroOverride(topology);

  const roleEdges: Edge[] = links.map((l) => {
    const isReworkEdge = l.handoff_type === 'rework';
    const proactive = l.handoff_type === 'proactive';
    const review = l.handoff_type === 'review';
    const stroke = isReworkEdge ? '#fb923c' : proactive ? '#39ff88' : review ? '#facc15' : '#33d1ff';
    const shouldAnimate = !zeroOverride && activeExecution && (runningNodeIds.has(l.source) || runningNodeIds.has(l.target));

    return {
      id: l.id,
      source: l.source,
      target: l.target,
      type: 'packet',
      label: edgeLabel(l.handoff_type, l.handoff_count),
      animated: shouldAnimate,
      style: {
        stroke,
        strokeWidth: isReworkEdge ? 3.1 : proactive ? 2.7 : 2.1,
        strokeDasharray: isReworkEdge ? '7 3' : undefined,
        filter: shouldAnimate ? `drop-shadow(0 0 5px ${stroke})` : 'none',
        opacity: zeroOverride ? 0.35 : activeExecution ? (shouldAnimate ? 1 : 0.7) : 0.4,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      labelStyle: { fill: stroke, fontWeight: 700, fontSize: 12 },
      labelBgStyle: { fill: 'rgba(6,10,18,0.78)', fillOpacity: 1 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
    };
  });

  const taskEdges: Edge[] = (topology.task_edges || []).map((e) => ({
    id: e.id,
    source: `task:${e.source_task_id}`,
    target: `task:${e.target_task_id}`,
    type: 'smoothstep',
    animated: false,
    style: {
      stroke: '#a78bfa',
      strokeWidth: 2,
      strokeDasharray: '5 4',
      opacity: 0.85,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa' },
    label: '↳ parent-child',
    labelStyle: { fill: '#c4b5fd', fontWeight: 700, fontSize: 11 },
    labelBgStyle: { fill: 'rgba(20, 12, 40, 0.7)', fillOpacity: 1 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  }));

  return [...roleEdges, ...taskEdges];
}

function buildLayout(topology: SwarmTopologyPayload): Node[] {
  const nodes = topology.nodes || [];
  const orchestrator = nodes.find((n) => n.type === 'orchestrator') || {
    id: 'orchestrator:main',
    type: 'orchestrator' as const,
    label: 'MC-MAIN',
  };
  const roles = nodes.filter((n) => n.type !== 'orchestrator');

  const normDomain = (d?: string) => String(d || 'SHARED').toUpperCase();
  const sharedRoles = roles.filter((r) => normDomain(r.domain) === 'SHARED');

  const laneOrder = ['CRYPTO', 'DATA_CENTER', 'MACRO', 'VENTURE'];
  const laneRoles = laneOrder.map((k) => ({
    key: k,
    roles: roles.filter((r) => normDomain(r.domain) === k),
  }));

  const activeExecution = hasAnyActiveExecution(topology);
  const zeroOverride = shouldGlobalZeroOverride(topology);

  const ROOT_Y = 0;
  const SHARED_Y = 400;
  const LANE_Y = 900;
  const TASK_Y = 1450;
  const CENTER_X = 1800;
  const LANE_SPACING = 820;

  const groupNodes: Node[] = [];
  const roleNodes: Node[] = [];

  const sharedColumns = Math.max(1, Math.min(2, Math.ceil(sharedRoles.length / 3)));
  const sharedRows = Math.max(1, Math.ceil(sharedRoles.length / sharedColumns));
  const sharedWidth = Math.max(GROUP_MIN_W, sharedColumns * ROLE_W + (sharedColumns - 1) * 22 + GROUP_PADDING * 2);
  const sharedHeight = sharedRows * ROLE_H + (sharedRows - 1) * 22 + GROUP_PADDING * 2 + 28;

  groupNodes.push({
    id: groupId('SHARED'),
    type: 'group',
    position: { x: CENTER_X - sharedWidth / 2, y: SHARED_Y },
    data: { label: 'SHARED' },
    draggable: true,
    selectable: true,
    style: {
      width: sharedWidth,
      height: sharedHeight,
      background: 'rgba(7, 20, 36, 0.42)',
      border: '1px solid rgba(56, 189, 248, 0.55)',
      borderRadius: '12px',
      boxShadow: '0 0 0 1px rgba(34, 211, 238, 0.2), 0 0 16px rgba(34, 211, 238, 0.15)',
      color: '#bae6fd',
      fontSize: '13px',
      fontWeight: 700,
      padding: '8px',
    },
  });

  sharedRoles.forEach((role, idx) => {
    const row = Math.floor(idx / sharedColumns);
    const col = idx % sharedColumns;
    const signal = topology.role_signals?.[role.id];
    const isRunningNode = !zeroOverride && activeExecution && Number(role.metrics?.running_runs || 0) > 0;
    roleNodes.push({
      id: role.id,
      position: {
        x: CENTER_X - sharedWidth / 2 + GROUP_PADDING + col * (ROLE_W + 22),
        y: SHARED_Y + GROUP_PADDING + 28 + row * (ROLE_H + 22),
      },
      style: { width: ROLE_W, height: ROLE_H },
      draggable: true,
      data: {
        label: (
          <div
            className={`swarm-node swarm-node-role break-words whitespace-pre-wrap ${!zeroOverride && signal?.risk ? 'swarm-node-risk' : ''} ${isRunningNode ? 'animate-pulse' : ''}`}
            style={!zeroOverride && signal?.rework ? { border: '1px solid rgba(251,146,60,0.8)', boxShadow: '0 0 12px rgba(251,146,60,0.45)' } : undefined}
          >
            <div className="swarm-node-title text-[15px] font-semibold text-slate-100 break-words whitespace-pre-wrap">{role.label}</div>
            <div className="swarm-node-meta text-[12px] text-slate-200 break-words">{role.domain ?? 'Shared'} · running {role.metrics?.running_runs ?? 0}</div>
          </div>
        ),
      },
    });
  });

  laneRoles.forEach((lane, i) => {
    const laneCenterX = CENTER_X + (i - 1.5) * LANE_SPACING;
    const cols = Math.max(1, Math.min(2, Math.ceil(lane.roles.length / 3)));
    const rows = Math.max(1, Math.ceil(lane.roles.length / cols));
    const width = Math.max(GROUP_MIN_W, cols * ROLE_W + (cols - 1) * 22 + GROUP_PADDING * 2);
    const height = rows * ROLE_H + (rows - 1) * 22 + GROUP_PADDING * 2 + 28;

    groupNodes.push({
      id: groupId(lane.key),
      type: 'group',
      position: { x: laneCenterX - width / 2, y: LANE_Y },
      data: { label: lane.key },
      draggable: true,
      selectable: true,
      style: {
        width,
        height,
        background: 'rgba(7, 20, 36, 0.42)',
        border: '1px solid rgba(56, 189, 248, 0.55)',
        borderRadius: '12px',
        boxShadow: '0 0 0 1px rgba(34, 211, 238, 0.2), 0 0 16px rgba(34, 211, 238, 0.15)',
        color: '#bae6fd',
        fontSize: '13px',
        fontWeight: 700,
        padding: '8px',
      },
    });

    lane.roles.forEach((role, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const signal = topology.role_signals?.[role.id];
      const isRunningNode = !zeroOverride && activeExecution && Number(role.metrics?.running_runs || 0) > 0;
      roleNodes.push({
        id: role.id,
        position: {
          x: laneCenterX - width / 2 + GROUP_PADDING + col * (ROLE_W + 22),
          y: LANE_Y + GROUP_PADDING + 28 + row * (ROLE_H + 22),
        },
        style: { width: ROLE_W, height: ROLE_H },
        draggable: true,
        data: {
          label: (
            <div
              className={`swarm-node swarm-node-role break-words whitespace-pre-wrap ${!zeroOverride && signal?.risk ? 'swarm-node-risk' : ''} ${isRunningNode ? 'animate-pulse' : ''}`}
              style={!zeroOverride && signal?.rework ? { border: '1px solid rgba(251,146,60,0.8)', boxShadow: '0 0 12px rgba(251,146,60,0.45)' } : undefined}
            >
              <div className="swarm-node-title text-[15px] font-semibold text-slate-100 break-words whitespace-pre-wrap">{role.label}</div>
              <div className="swarm-node-meta text-[12px] text-slate-200 break-words">{role.domain ?? 'Shared'} · running {role.metrics?.running_runs ?? 0}</div>
            </div>
          ),
        },
      });
    });
  });

  const taskNodesRaw = topology.task_nodes || [];
  const taskColumns = 4;
  const taskCardW = 280;
  const taskCardH = 92;
  const taskGapX = 36;
  const taskGapY = 24;
  const taskTotalWidth = taskColumns * taskCardW + (taskColumns - 1) * taskGapX;
  const taskStartX = CENTER_X - taskTotalWidth / 2;

  const taskNodes: Node[] = taskNodesRaw.map((t, idx) => {
    const row = Math.floor(idx / taskColumns);
    const col = idx % taskColumns;
    const isSub = Boolean(t.parent_task_id);
    return {
      id: `task:${t.task_id}`,
      position: {
        x: taskStartX + col * (taskCardW + taskGapX),
        y: TASK_Y + row * (taskCardH + taskGapY),
      },
      draggable: true,
      style: { width: taskCardW, height: taskCardH },
      data: {
        label: (
          <div className="swarm-node break-words whitespace-pre-wrap" style={{ border: '1px solid rgba(167,139,250,0.45)', background: 'rgba(76,29,149,0.18)' }}>
            <div className="swarm-node-title text-[13px] font-semibold text-violet-100 line-clamp-2">{t.title}</div>
            <div className="swarm-node-meta text-[11px] text-violet-200 mt-1">{t.status}</div>
            {isSub && <div className="text-[10px] text-fuchsia-200 mt-1">↳ child of {String(t.parent_task_id).slice(0, 8)}</div>}
          </div>
        ),
      },
    };
  });

  const orchestratorNode: Node = {
    id: orchestrator.id,
    position: { x: CENTER_X - ORCH_W / 2, y: ROOT_Y },
    style: { width: ORCH_W, height: ORCH_H },
    draggable: true,
    data: {
      label: (
        <div className={`swarm-node swarm-node-orchestrator break-words whitespace-pre-wrap ${!zeroOverride && activeExecution ? 'animate-pulse' : ''}`}>
          <div className="swarm-node-title text-[18px] font-bold text-slate-50">MC-MAIN</div>
          <div className="swarm-node-meta text-[13px] text-slate-200">Top-level Command Root</div>
        </div>
      ),
    },
  };

  return [orchestratorNode, ...groupNodes, ...roleNodes, ...taskNodes];
}

function readSavedLayout(): Record<string, { x: number; y: number }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function applySavedPositions(nodes: Node[]): Node[] {
  const saved = readSavedLayout();
  return nodes.map((n) => {
    const p = saved[n.id];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return n;
    return { ...n, position: { x: p.x, y: p.y } };
  });
}

export function SwarmTopologyCanvas({ topology, onNodeSelect }: Props) {
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const initialNodes = useMemo(() => applySavedPositions(buildLayout(topology)), [topology]);
  const initialEdges = useMemo(() => buildEdges(topology), [topology]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const fitCanvas = useCallback((instance: ReactFlowInstance | null) => {
    if (!instance) return;
    setTimeout(() => {
      requestAnimationFrame(() => {
        instance.fitView({ padding: 0.08, duration: 520, includeHiddenNodes: true, minZoom: 0.2, maxZoom: 1.35 });
      });
    }, 120);
  }, []);

  useEffect(() => {
    setNodes(applySavedPositions(buildLayout(topology)));
    setEdges(buildEdges(topology));
    fitCanvas(rfInstance);
  }, [topology, setNodes, setEdges, fitCanvas, rfInstance]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    if (node.type === 'group') return;
    onNodeSelect?.(node);
  };

  const onSaveFormation = () => {
    try {
      const payload = Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('failed to save topology layout', e);
    }
  };

  return (
    <div className="relative h-full min-h-[900px] rounded-xl border border-mc-border bg-[#070b12] overflow-hidden">
      <button
        onClick={onSaveFormation}
        className="absolute right-3 top-3 z-20 px-3 py-2 rounded-md text-xs font-semibold bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30"
      >
        💾 Save Formation
      </button>

      <ReactFlow
        fitView
        nodesDraggable={true}
        onInit={(instance) => {
          setRfInstance(instance);
          fitCanvas(instance);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => onNodeSelect?.(null)}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background color="#10243f" gap={22} />
        <MiniMap nodeColor={(node) => (node.type === 'group' ? '#164e63' : String(node.id).startsWith('task:') ? '#7c3aed' : '#2b6cb0')} pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
