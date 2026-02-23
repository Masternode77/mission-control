'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export function PacketEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <svg className="packet-overlay" width="0" height="0" aria-hidden>
          <defs>
            <path id={`packet-path-${id}`} d={edgePath} />
          </defs>
          <circle r="3.2" className="packet-dot">
            <animateMotion dur="1.8s" repeatCount="indefinite" rotate="auto">
              <mpath href={`#packet-path-${id}`} />
            </animateMotion>
          </circle>
        </svg>
      </EdgeLabelRenderer>
    </>
  );
}
