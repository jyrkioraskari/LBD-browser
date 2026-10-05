import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Building2, ChevronDown, Layers3, Map, PanelsTopLeft, Shapes, Warehouse } from 'lucide-react';
import GeometryPreview from './GeometryPreview';

export interface BuildingNodeData extends Record<string, unknown> {
  label: string;
  kind: 'site' | 'building' | 'storey' | 'space' | 'element' | 'resource';
  typeLabel: string;
  neighborCount: number;
  expanded: boolean;
  focused: boolean;
  geometryObj?: string;
}

const icons = {
  site: Map,
  building: Building2,
  storey: Layers3,
  space: PanelsTopLeft,
  element: Warehouse,
  resource: Shapes,
};

export default function BuildingNode({ data, selected }: NodeProps) {
  const node = data as BuildingNodeData;
  const Icon = icons[node.kind];
  return (
    <div className={`building-node kind-${node.kind}${selected ? ' selected' : ''}${node.focused ? ' focused' : ''}`}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      {node.geometryObj ? (
        <GeometryPreview
          encodedObj={node.geometryObj}
          fallback={<div className="node-icon"><Icon size={18} strokeWidth={1.8} /></div>}
        />
      ) : <div className="node-icon"><Icon size={18} strokeWidth={1.8} /></div>}
      <div className="node-copy">
        <span className="node-type">{node.typeLabel}</span>
        <strong title={node.label}>{node.label}</strong>
      </div>
      {node.neighborCount > 0 && (
        <span className={`node-expand${node.expanded ? ' is-open' : ''}`} title={node.expanded ? 'Collapse connections' : 'Open connections'}>
          <span>{node.neighborCount}</span>
          <ChevronDown size={14} />
        </span>
      )}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
