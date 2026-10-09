import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Building2, ChevronDown, Layers3, Map, PanelsTopLeft, Shapes, TableProperties, Warehouse } from 'lucide-react';
import GeometryPreview from './GeometryPreview';

export interface BuildingNodeData extends Record<string, unknown> {
  label: string;
  kind: 'site' | 'building' | 'storey' | 'space' | 'element' | 'resource';
  typeLabel: string;
  neighborCount: number;
  expanded: boolean;
  focused: boolean;
  geometryObj?: string;
  propertySet?: boolean;
  setKind?: 'property' | 'quantity';
  propertyRows?: { name: string; value: string; unit?: string }[];
  attributeRows?: { name: string; value: string }[];
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
  if (node.propertySet && node.propertyRows) {
    return (
      <div className={`building-node property-set-node${selected ? ' selected' : ''}${node.focused ? ' focused' : ''}`}>
        <Handle type="target" position={Position.Left} className="node-handle" />
        <div className="pset-node-head">
          <span className="node-icon"><TableProperties size={17} strokeWidth={1.8} /></span>
          <span className="node-copy"><span className="node-type">{node.setKind === 'quantity' ? 'Quantity set' : 'Property set'}</span><strong title={node.label}>{node.label}</strong></span>
          {node.neighborCount > 0 && (
            <span className={`node-expand${node.expanded ? ' is-open' : ''}`}>
              <span>{node.neighborCount}</span><ChevronDown size={14} />
            </span>
          )}
        </div>
        <div className="pset-table-wrap nowheel nodrag">
          <table className="pset-table">
            <thead><tr><th>{node.setKind === 'quantity' ? 'Quantity' : 'Property'}</th><th>Value</th></tr></thead>
            <tbody>
              {node.propertyRows?.map((property, index) => (
                <tr key={`${property.name}-${index}`}>
                  <td title={property.name}>{property.name}</td>
                  <td title={`${property.value}${property.unit ? ` ${property.unit}` : ''}`}>
                    {property.value}{property.unit && <small>{property.unit}</small>}
                  </td>
                </tr>
              ))}
              {!node.propertyRows?.length && <tr><td colSpan={2} className="pset-empty">No values</td></tr>}
            </tbody>
          </table>
        </div>
        <Handle type="source" position={Position.Right} className="node-handle" />
      </div>
    );
  }
  if (node.attributeRows?.length) {
    return (
      <div className={`building-node attribute-node kind-${node.kind}${selected ? ' selected' : ''}${node.focused ? ' focused' : ''}`}>
        <Handle type="target" position={Position.Left} className="node-handle" />
        <div className="pset-node-head">
          {node.geometryObj ? (
            <GeometryPreview encodedObj={node.geometryObj} fallback={<span className="node-icon"><Icon size={17} strokeWidth={1.8} /></span>} />
          ) : <span className="node-icon"><Icon size={17} strokeWidth={1.8} /></span>}
          <span className="node-copy"><span className="node-type">{node.typeLabel}</span><strong title={node.label}>{node.label}</strong></span>
          {node.neighborCount > 0 && (
            <span className={`node-expand${node.expanded ? ' is-open' : ''}`}>
              <span>{node.neighborCount}</span><ChevronDown size={14} />
            </span>
          )}
        </div>
        <div className="pset-table-wrap nowheel nodrag">
          <table className="pset-table attribute-table">
            <thead><tr><th>Attribute</th><th>Value</th></tr></thead>
            <tbody>
              {node.attributeRows.map((attribute, index) => (
                <tr key={`${attribute.name}-${index}`}>
                  <td title={attribute.name}>{attribute.name}</td>
                  <td title={attribute.value}>{attribute.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Handle type="source" position={Position.Right} className="node-handle" />
      </div>
    );
  }
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
