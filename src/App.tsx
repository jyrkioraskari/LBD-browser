import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronsLeft,
  FileCode2,
  Focus,
  Github,
  Info,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import BuildingNode, { type BuildingNodeData } from './BuildingNode';
import {
  compactUri,
  connectedIds,
  deriveVisible,
  expansionAfterClick,
  expansionConnectedIds,
  graphEdges,
  isPropertySetResource,
  localName,
  parseTurtle,
  prettify,
  propertySetConnectionIds,
  resourceKind,
  type GraphModel,
} from './graph';
import { SAMPLE_TURTLE } from './sample';

const NODE_WIDTH = 248;
const NODE_HEIGHT = 76;
const nodeTypes = { building: BuildingNode };

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  anchorId?: string,
  anchorPosition?: { x: number; y: number },
): Node[] {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 34, marginx: 36, marginy: 36 });
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  const layouted = nodes.map((node) => {
    const position = graph.node(node.id);
    return { ...node, position: { x: position.x - NODE_WIDTH / 2, y: position.y - NODE_HEIGHT / 2 } };
  });
  const anchor = anchorId ? layouted.find((node) => node.id === anchorId) : undefined;
  if (!anchor || !anchorPosition) return layouted;
  const offsetX = anchorPosition.x - anchor.position.x;
  const offsetY = anchorPosition.y - anchor.position.y;
  return layouted.map((node) => ({
    ...node,
    position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
  }));
}

function GraphWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadSequenceRef = useRef(0);
  const nodePositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const fittedModelRef = useRef<GraphModel | null>(null);
  const { fitView, setCenter } = useReactFlow();
  const [model, setModel] = useState<GraphModel | null>(null);
  const [fileName, setFileName] = useState('Duplex sample.ttl');
  const [focusId, setFocusId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [radius, setRadius] = useState(2);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const loadTurtle = useCallback(async (source: string, name: string) => {
    const loadSequence = ++loadSequenceRef.current;
    setLoading(true);
    setError('');
    setModel(null);
    setNodes([]);
    setEdges([]);
    setFocusId('');
    setSelectedId('');
    setExpanded(new Set());
    setQuery('');
    nodePositionsRef.current.clear();
    fittedModelRef.current = null;
    try {
      const nextModel = await parseTurtle(source);
      if (loadSequence !== loadSequenceRef.current) return;
      setModel(nextModel);
      setFileName(name);
      setFocusId(nextModel.rootId);
      setSelectedId(nextModel.rootId);
      setExpanded(new Set());
      setQuery('');
    } catch (reason) {
      if (loadSequence !== loadSequenceRef.current) return;
      setError(reason instanceof Error ? reason.message : 'The Turtle document could not be parsed.');
    } finally {
      if (loadSequence === loadSequenceRef.current) setLoading(false);
    }
  }, [setEdges, setNodes]);

  useEffect(() => {
    void loadTurtle(SAMPLE_TURTLE, 'Duplex sample.ttl');
  }, [loadTurtle]);

  const visibleIds = useMemo(() => {
    if (!model || !focusId) return new Set<string>();
    return deriveVisible(focusId, expanded, model.resources, radius);
  }, [expanded, focusId, model, radius]);

  useEffect(() => {
    if (!model) return;
    const flowNodes: Node<BuildingNodeData>[] = [...model.resources.values()]
      .filter((resource) => visibleIds.has(resource.id))
      .map((resource) => {
        const id = resource.id;
        const kind = resourceKind(resource);
        return {
          id,
          type: 'building',
          position: { x: 0, y: 0 },
          data: {
            label: resource.label,
            kind,
            typeLabel: prettify(kind),
            neighborCount: expansionConnectedIds(id, model.resources).size,
            expanded: expanded.has(id),
            focused: focusId === id,
            geometryObj: resource.geometryObj,
          },
        };
      });
    const flowEdges: Edge[] = graphEdges(model, visibleIds).map((quad, index) => ({
      id: `${quad.subject.value}-${quad.predicate.value}-${quad.object.value}-${index}`,
      source: quad.subject.value,
      target: quad.object.value,
      label: prettify(localName(quad.predicate.value)),
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#8f938d' },
      style: { stroke: '#a8aaa5', strokeWidth: 1.35 },
      labelStyle: { fill: '#666a65', fontSize: 10.5, fontWeight: 600 },
      labelBgStyle: { fill: '#f4f1e9', fillOpacity: 0.92 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }));
    const layoutedNodes = layoutGraph(
      flowNodes,
      flowEdges,
      focusId,
      nodePositionsRef.current.get(focusId),
    );
    nodePositionsRef.current = new Map(layoutedNodes.map((node) => [node.id, node.position]));
    setNodes(layoutedNodes);
    setEdges(flowEdges);
    if (fittedModelRef.current !== model) {
      fittedModelRef.current = model;
      requestAnimationFrame(() => fitView({ duration: 420, padding: 0.25, maxZoom: 1.1 }));
    }
  }, [expanded, fitView, focusId, model, setEdges, setNodes, visibleIds]);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (!model) return;
    setSelectedId(node.id);
    setFocusId(node.id);
    setExpanded((current) => expansionAfterClick(node.id, current));
  }, [model]);

  const openFile = useCallback((file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void loadTurtle(String(reader.result), file.name);
    reader.onerror = () => setError('The selected file could not be read.');
    reader.readAsText(file);
  }, [loadTurtle]);

  const resetToRoot = useCallback(() => {
    if (!model) return;
    setFocusId(model.rootId);
    setSelectedId(model.rootId);
    setExpanded(new Set());
    requestAnimationFrame(() => fitView({ duration: 400, padding: 0.3 }));
  }, [fitView, model]);

  const searchResults = useMemo(() => {
    if (!model || query.trim().length < 2) return [];
    const needle = query.toLocaleLowerCase();
    return [...model.resources.values()]
      .filter((resource) => !isPropertySetResource(resource))
      .filter((resource) => resource.label.toLocaleLowerCase().includes(needle) || resource.id.toLocaleLowerCase().includes(needle))
      .slice(0, 8);
  }, [model, query]);

  const jumpTo = (id: string) => {
    setFocusId(id);
    setSelectedId(id);
    setExpanded(new Set());
    setQuery('');
    const node = nodes.find((candidate) => candidate.id === id);
    if (node) void setCenter(node.position.x, node.position.y, { duration: 400, zoom: 1 });
  };

  const selected = model?.resources.get(selectedId);
  const root = model?.resources.get(model.rootId);
  const selectedConnectionIds = selected && model
    ? [...connectedIds(selected.id, model.resources)]
    : [];
  const selectedPropertySetIds = selected && model
    ? propertySetConnectionIds(selected.id, model.resources)
    : new Set<string>();
  const selectedPropertySets = selected && model
    ? [...selectedPropertySetIds].map((id) => {
      const relation = selected.outgoing.find((quad) => quad.object.value === id)
        ?? selected.incoming.find((quad) => quad.subject.value === id);
      const relationName = relation ? localName(relation.predicate.value) : '';
      return {
        id,
        label: /^pset_/i.test(relationName)
          ? prettify(relationName)
          : model.resources.get(id)?.label ?? compactUri(id, model.prefixes),
      };
    })
    : [];
  const hasPropertySets = selectedPropertySetIds.size > 0;
  const regularConnectionIds = selectedConnectionIds.filter((id) => !selectedPropertySetIds.has(id));

  return (
    <div
      className={`app-shell${inspectorOpen ? '' : ' inspector-hidden'}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        openFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <a className="brand" href="#" aria-label="LBD Browser home" onClick={(event) => { event.preventDefault(); resetToRoot(); }}>
          <span className="brand-mark"><span /><span /><span /></span>
          <span><strong>LBD</strong> Browser</span>
        </a>
        <div className="file-status" title={fileName}>
          <FileCode2 size={15} />
          <span>{fileName}</span>
          {model && <em>{model.resources.size.toLocaleString()} resources</em>}
        </div>
        <div className="topbar-actions">
          <a className="icon-link" href="https://github.com/jyrkioraskari/IFCtoLBD" target="_blank" rel="noreferrer" title="IFCtoLBD on GitHub"><Github size={18} /></a>
          <button className="button primary" onClick={() => inputRef.current?.click()}><Upload size={16} /> Open Turtle</button>
          <input ref={inputRef} type="file" accept=".ttl,.turtle,text/turtle" hidden onChange={(event) => openFile(event.target.files?.[0])} />
        </div>
      </header>

      <aside className="left-panel">
        <div className="eyebrow">Current model</div>
        <h1>Explore the building,<br />one relation at a time.</h1>
        <p className="intro">Select a node to reveal its RDF connections. Distant branches fold away as your focus moves.</p>

        <div className="search-wrap">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a resource…" aria-label="Find a resource" />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((resource) => (
                <button key={resource.id} onClick={() => jumpTo(resource.id)}>
                  <span className={`result-dot kind-${resourceKind(resource)}`} />
                  <span><strong>{resource.label}</strong><small>{prettify(resourceKind(resource))}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="section-label"><span>Navigation</span></div>
        <button className="root-card" onClick={resetToRoot} disabled={!root}>
          <span className="root-icon"><Focus size={17} /></span>
          <span><small>Core concept</small><strong>{root?.label ?? 'Finding root…'}</strong><em>{root ? compactUri(root.types[0] ?? root.id, model!.prefixes) : ''}</em></span>
          <ArrowUpRight size={15} />
        </button>

        <label className="distance-control">
          <span><strong>Focus distance</strong><small>Close nodes farther than</small></span>
          <select value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            <option value={1}>1 step</option>
            <option value={2}>2 steps</option>
            <option value={3}>3 steps</option>
          </select>
        </label>

        <div className="section-label"><span>Node types</span></div>
        <div className="legend">
          {(['site', 'building', 'storey', 'space', 'element', 'resource'] as const).map((kind) => (
            <span key={kind}><i className={`kind-${kind}`} />{prettify(kind)}</span>
          ))}
        </div>

        <div className="tip"><Info size={15} /><span><strong>Click a node to focus and open it.</strong> Click it again to fold its linked branch.</span></div>
      </aside>

      <main className="canvas-wrap">
        {loading && <div className="loading"><span /><p>Reading linked building data…</p></div>}
        {error && (
          <div className="error-toast"><AlertCircle size={18} /><span><strong>Couldn’t open Turtle</strong>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedId('')}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodeClickDistance={8}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          minZoom={0.2}
          maxZoom={1.8}
          fitView
          proOptions={{ hideAttribution: false }}
        >
          <Background color="#d9d6cc" gap={28} size={1} variant={BackgroundVariant.Dots} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => `var(--${String(node.data?.kind ?? 'resource')})`}
            maskColor="rgba(244, 241, 233, .72)"
          />
        </ReactFlow>
        <div className="canvas-meta">
          <span><i className="pulse" /> Focused on <strong>{model?.resources.get(focusId)?.label ?? '—'}</strong></span>
          <span>{visibleIds.size} visible</span>
          <button onClick={resetToRoot}><RotateCcw size={13} /> Reset</button>
        </div>
        <button className="inspector-toggle" onClick={() => setInspectorOpen((open) => !open)} title={inspectorOpen ? 'Close inspector' : 'Open inspector'}>
          {inspectorOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </main>

      <aside className="inspector">
        <div className="inspector-head">
          <div><span className="eyebrow">Resource inspector</span><strong>{selected ? 'Selection' : 'Nothing selected'}</strong></div>
          <button onClick={() => setInspectorOpen(false)}><ChevronsLeft size={18} /></button>
        </div>
        {selected ? (
          <div className="inspector-body">
            <div className={`resource-badge kind-${resourceKind(selected)}`}>{prettify(resourceKind(selected))}</div>
            <h2>{selected.label}</h2>
            <code>{compactUri(selected.id, model!.prefixes)}</code>

            <div className="property-group">
              <h3>RDF types <span>{selected.types.length}</span></h3>
              {selected.types.length ? selected.types.map((type) => <div className="type-row" key={type}><Check size={13} />{compactUri(type, model!.prefixes)}</div>) : <p className="empty">No explicit type</p>}
            </div>

            <div className="property-group">
              <h3>Attributes <span>{selected.properties.length}</span></h3>
              {selected.properties.map((quad, index) => (
                <div className="property-row" key={`${quad.predicate.value}-${index}`}>
                  <span>{prettify(localName(quad.predicate.value))}</span>
                  <strong title={quad.object.value}>{quad.object.value}</strong>
                </div>
              ))}
              {!selected.properties.length && <p className="empty">No literal attributes</p>}
            </div>

            {hasPropertySets && (
              <div className="property-group">
                <h3>Property sets <span>{selectedPropertySetIds.size}</span></h3>
                {selectedPropertySets.map((propertySet) => (
                  <div className="type-row" key={propertySet.id} title={propertySet.id}>
                    <Check size={13} />{propertySet.label}
                  </div>
                ))}
              </div>
            )}

            <div className="property-group">
              <h3>Connections <span>{regularConnectionIds.length}</span></h3>
              {regularConnectionIds.slice(0, 12).map((id) => (
                <button className="connection-row" key={id} onClick={() => jumpTo(id)}>
                  <span className={`result-dot kind-${resourceKind(model!.resources.get(id)!)}`} />
                  <span>{model!.resources.get(id)?.label}</span><ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-selection"><span><PanelRightOpen size={24} /></span><h2>Select a node</h2><p>Its types, literal properties, and direct connections will appear here.</p></div>
        )}
      </aside>

      {dragging && <div className="drop-zone"><Upload size={30} /><strong>Drop your Turtle file</strong><span>It stays in this browser</span></div>}
    </div>
  );
}

export default function App() {
  return <ReactFlowProvider><GraphWorkspace /></ReactFlowProvider>;
}
