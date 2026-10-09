import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export default function RelationEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });
  const arrowMargin = 24;
  let labelX = targetX;
  let labelY = targetY;
  let labelAnchor = 'translate(-50%, 0)';
  if (targetPosition === Position.Left) {
    labelX -= arrowMargin;
    labelAnchor = 'translate(-100%, -50%)';
  } else if (targetPosition === Position.Right) {
    labelX += arrowMargin;
    labelAnchor = 'translate(0, -50%)';
  } else if (targetPosition === Position.Top) {
    labelY -= arrowMargin;
    labelAnchor = 'translate(-50%, -100%)';
  } else {
    labelY += arrowMargin;
  }

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="relation-edge-label"
            style={{ transform: `${labelAnchor} translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
