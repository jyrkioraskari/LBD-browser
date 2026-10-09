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
  type OnNodeDrag,
  type NodeMouseHandler,
} from '@xyflow/react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronsLeft,
  Clock3,
  FileCode2,
  Github,
  House,
  Info,
  Layers3,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Ruler,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import BuildingNode, { type BuildingNodeData } from './BuildingNode';
import RelationEdge from './RelationEdge';
import {
  attributeEntriesFor,
  compactUri,
  deriveVisible,
  expansionAfterClick,
  expansionConnectedIds,
  graphEdges,
  isAttributePredicate,
  isPropertySetResource,
  isQuantitySetResource,
  localName,
  parseTurtle,
  prettify,
  propertyEntriesFor,
  quadLinkCategory,
  resourceKind,
  type GraphModel,
  type LinkFilter,
} from './graph';

const DEFAULT_TURTLE_URL = new URL('../Duplex_LBD.ttl', import.meta.url).href;

const NODE_WIDTH = 248;
const NODE_HEIGHT = 76;
const PROPERTY_SET_HEIGHT = 224;
const ATTRIBUTE_NODE_HEIGHT = 224;
const nodeTypes = { building: BuildingNode };
const edgeTypes = { relation: RelationEdge };
const LINK_FILTERS: { id: LinkFilter; label: string; description: string; icon: typeof Layers3 }[] = [
  { id: 'all', label: 'All relations', description: 'Complete linked view', icon: Layers3 },
  { id: 'topology', label: 'Spatial topology', description: 'Building structure & adjacency', icon: Network },
  { id: 'geometry', label: 'Geometry', description: 'Shapes & representations', icon: Ruler },
  { id: 'properties', label: 'Properties', description: 'Property sets & metadata', icon: SlidersHorizontal },
];

const EDGE_COLORS = {
  topology: '#477465',
  geometry: '#9a6848',
  properties: '#6d6a94',
  other: '#8f938d',
};

function expansionForDepth(
  rootId: string,
  model: GraphModel,
  depth: number,
  filter: LinkFilter,
) {
  const expanded = new Set<string>();
  let frontier = new Set([rootId]);
  const visited = new Set<string>();
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      expanded.add(id);
      for (const neighbor of expansionConnectedIds(id, model.resources, 10, filter)) {
        if (!visited.has(neighbor)) next.add(neighbor);
      }
    }
    frontier = next;
  }
  return expanded;
}

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  anchorId?: string,
  anchorPosition?: { x: number; y: number },
): Node[] {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 34, marginx: 36, marginy: 36 });
  const heightFor = (node: Node) => node.data?.propertySet
    ? PROPERTY_SET_HEIGHT
    : Array.isArray(node.data?.attributeRows) && node.data.attributeRows.length
      ? ATTRIBUTE_NODE_HEIGHT
      : NODE_HEIGHT;
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: heightFor(node) }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  const layouted = nodes.map((node) => {
    const position = graph.node(node.id);
    return { ...node, position: { x: position.x - NODE_WIDTH / 2, y: position.y - heightFor(node) / 2 } };
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
  const startupLoadCancelledRef = useRef(false);
  const nodePositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const fittedModelRef = useRef<GraphModel | null>(null);
  const homeFitPendingRef = useRef(false);
  const { fitView, setCenter } = useReactFlow();
  const [model, setModel] = useState<GraphModel | null>(null);
  const [fileName, setFileName] = useState('Duplex_LBD.ttl');
  const [focusId, setFocusId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [radius, setRadius] = useState(2);
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [homeFitRequest, setHomeFitRequest] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const loadTurtle = useCallback(async (source: string, name: string, initialRadius = 1) => {
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
    setRadius(initialRadius);
    setLinkFilter('all');
    nodePositionsRef.current.clear();
    fittedModelRef.current = null;
    try {
      const nextModel = await parseTurtle(source);
      if (loadSequence !== loadSequenceRef.current) return;
      setModel(nextModel);
      setFileName(name);
      setFocusId(nextModel.rootId);
      setSelectedId(nextModel.rootId);
      setExpanded(expansionForDepth(nextModel.rootId, nextModel, initialRadius, 'all'));
      setQuery('');
    } catch (reason) {
      if (loadSequence !== loadSequenceRef.current) return;
      setError(reason instanceof Error ? reason.message : 'The Turtle document could not be parsed.');
    } finally {
      if (loadSequence === loadSequenceRef.current) setLoading(false);
    }
  }, [setEdges, setNodes]);

  useEffect(() => {
    let active = true;
    void fetch(DEFAULT_TURTLE_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load the default Turtle file (${response.status}).`);
        return response.text();
      })
      .then((source) => {
        if (active && !startupLoadCancelledRef.current) void loadTurtle(source, 'Duplex_LBD.ttl', 2);
      })
      .catch((reason) => {
        if (!active || startupLoadCancelledRef.current) return;
        setError(reason instanceof Error ? reason.message : 'The default Turtle file could not be loaded.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [loadTurtle]);

  const visibleIds = useMemo(() => {
    if (!model || !focusId) return new Set<string>();
    return deriveVisible(focusId, expanded, model.resources, radius, linkFilter);
  }, [expanded, focusId, linkFilter, model, radius]);

  useEffect(() => {
    if (!model) return;
    const flowNodes: Node<BuildingNodeData>[] = [...model.resources.values()]
      .filter((resource) => visibleIds.has(resource.id))
      .map((resource) => {
        const id = resource.id;
        const kind = resourceKind(resource);
        const propertySet = isPropertySetResource(resource);
        const setKind = propertySet && isQuantitySetResource(resource) ? 'quantity' : 'property';
        const propertyRows = propertySet && linkFilter === 'properties'
          ? propertyEntriesFor(resource, model.resources).map((property) => ({
            name: property.name,
            value: property.value,
            unit: property.unit,
          }))
          : undefined;
        const attributeRows = propertySet || linkFilter === 'all'
          ? undefined
          : attributeEntriesFor(resource, model.resources).map((attribute) => ({
            name: attribute.name,
            value: attribute.value,
          }));
        return {
          id,
          type: 'building',
          position: { x: 0, y: 0 },
          data: {
            label: resource.label,
            kind,
            typeLabel: propertySet ? prettify(`${setKind} set`) : prettify(kind),
            neighborCount: expansionConnectedIds(id, model.resources, 10, linkFilter).size,
            expanded: expanded.has(id),
            focused: focusId === id,
            geometryObj: resource.geometryObj,
            propertySet,
            setKind,
            propertyRows,
            attributeRows,
          },
        };
      });
    const flowEdges: Edge[] = graphEdges(model, visibleIds, linkFilter).map((quad, index) => {
      const category = quadLinkCategory(quad, model.resources);
      const color = EDGE_COLORS[category];
      const contextualTopology = category === 'topology'
        && (linkFilter === 'properties' || linkFilter === 'geometry');
      return {
      id: `${quad.subject.value}-${quad.predicate.value}-${quad.object.value}-${index}`,
      source: quad.subject.value,
      target: quad.object.value,
      label: prettify(localName(quad.predicate.value)),
      type: 'relation',
      markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color },
      style: {
        stroke: color,
        strokeWidth: 1.45,
        ...(contextualTopology ? { strokeDasharray: '6 5' } : {}),
      },
      labelStyle: { fill: '#666a65', fontSize: 10.5, fontWeight: 600 },
      labelBgStyle: { fill: '#f4f1e9', fillOpacity: 0.92 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      };
    });
    const layoutedNodes = layoutGraph(
      flowNodes,
      flowEdges,
      focusId,
      nodePositionsRef.current.get(focusId),
    );
    nodePositionsRef.current = new Map(layoutedNodes.map((node) => [node.id, node.position]));
    setNodes(layoutedNodes);
    setEdges(flowEdges);
    if (homeFitPendingRef.current) {
      homeFitPendingRef.current = false;
      const homeNode = layoutedNodes.find((node) => node.id === model.rootId);
      if (homeNode) {
        const homeHeight = Array.isArray(homeNode.data?.attributeRows) && homeNode.data.attributeRows.length
          ? ATTRIBUTE_NODE_HEIGHT
          : NODE_HEIGHT;
        requestAnimationFrame(() => setCenter(
          homeNode.position.x + NODE_WIDTH / 2,
          homeNode.position.y + homeHeight / 2,
          { duration: 420, zoom: 1.05 },
        ));
      }
    }
    if (fittedModelRef.current !== model) {
      fittedModelRef.current = model;
      requestAnimationFrame(() => fitView({ duration: 420, padding: 0.25, maxZoom: 1.1 }));
    }
  }, [expanded, fitView, focusId, homeFitRequest, linkFilter, model, setCenter, setEdges, setNodes, visibleIds]);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (!model) return;
    setSelectedId(node.id);
    setFocusId(node.id);
    setExpanded((current) => expansionAfterClick(node.id, current, linkFilter === 'topology'));
  }, [linkFilter, model]);

  const handleNodeDragStop: OnNodeDrag = useCallback((_, node) => {
    nodePositionsRef.current.set(node.id, node.position);
  }, []);

  const openFile = useCallback((file?: File) => {
    if (!file) return;
    startupLoadCancelledRef.current = true;
    const reader = new FileReader();
    reader.onload = () => void loadTurtle(String(reader.result), file.name);
    reader.onerror = () => setError('The selected file could not be read.');
    reader.readAsText(file);
  }, [loadTurtle]);

  const resetToRoot = useCallback(() => {
    if (!model) return;
    homeFitPendingRef.current = true;
    setHomeFitRequest((request) => request + 1);
    setFocusId(model.rootId);
    setSelectedId(model.rootId);
    setExpanded(expansionForDepth(model.rootId, model, 2, linkFilter));
    setRadius(2);
  }, [linkFilter, model]);

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
  const propertyEntries = selected && model ? propertyEntriesFor(selected, model.resources) : [];
  const attributeEntries = selected && model ? attributeEntriesFor(selected, model.resources) : [];
  const ordinaryAttributes = selected?.properties
    .filter((quad) => !(quad.predicate.value.startsWith('https://w3id.org/props#')
      || /(?:property_simple|attribute_simple|quantity_simple)$/i.test(localName(quad.predicate.value)))) ?? [];
  const propertyGroups = [...propertyEntries.reduce((groups, property) => {
    const groupName = property.setName ?? 'Ungrouped properties';
    const group = groups.get(groupName) ?? [];
    group.push(property);
    groups.set(groupName, group);
    return groups;
  }, new Map<string, typeof propertyEntries>())];
  const selectedLinks = selected ? [
    ...selected.outgoing
      .filter((quad) => quad.predicate.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
        && !isAttributePredicate(quad.predicate.value, model!.resources)
        && (quad.object.termType === 'NamedNode' || quad.object.termType === 'BlankNode')
        && model?.resources.has(quad.object.value))
      .map((quad) => ({ quad, neighborId: quad.object.value, direction: 'outgoing' as const })),
    ...selected.incoming.map((quad) => ({ quad, neighborId: quad.subject.value, direction: 'incoming' as const })),
  ] : [];

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
        </div>
        <div className="topbar-actions">
          <a className="icon-link" href="https://github.com/jyrkioraskari/IFCtoLBD" target="_blank" rel="noreferrer" title="IFCtoLBD on GitHub"><Github size={18} /></a>
        </div>
      </header>

      <aside className="left-panel">
        <button className="button primary open-file-button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Open Turtle</button>
        <input ref={inputRef} type="file" accept=".ttl,.turtle,text/turtle" hidden onChange={(event) => openFile(event.target.files?.[0])} />
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
        <button className="home-button" onClick={resetToRoot} disabled={!model}>
          <House size={16} /> Home
        </button>

        <label className="distance-control">
          <span><strong>Focus distance</strong><small>Close nodes farther than</small></span>
          <select value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            <option value={1}>1 step</option>
            <option value={2}>2 steps</option>
            <option value={3}>3 steps</option>
          </select>
        </label>

        <div className="section-label"><span>Lens</span></div>
        <div className="relation-lens" role="radiogroup" aria-label="Filter graph relations">
          {LINK_FILTERS.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.id}
                className={`lens-option${linkFilter === filter.id ? ' active' : ''}`}
                onClick={() => setLinkFilter(filter.id)}
                role="radio"
                aria-checked={linkFilter === filter.id}
              >
                <span className={`lens-icon category-${filter.id}`}><Icon size={14} /></span>
                <span><strong>{filter.label}</strong><small>{filter.description}</small></span>
                <i />
              </button>
            );
          })}
        </div>
        <p className="lens-note">Changes the graph only. The inspector always shows every relation.</p>

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
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => setSelectedId('')}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable
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
          <span>{visibleIds.size} visible · {LINK_FILTERS.find((filter) => filter.id === linkFilter)?.label}</span>
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
              <h3>Attributes <span>{attributeEntries.length + ordinaryAttributes.length}</span></h3>
              {attributeEntries.map((attribute) => (
                <div className="property-row" key={attribute.id}>
                  <span>{attribute.name}</span>
                  <strong title={attribute.value}>{attribute.value}</strong>
                </div>
              ))}
              {ordinaryAttributes.map((quad, index) => (
                <div className="property-row" key={`${quad.predicate.value}-${index}`}>
                  <span>{prettify(localName(quad.predicate.value))}</span>
                  <strong title={quad.object.value}>{quad.object.value}</strong>
                </div>
              ))}
              {!attributeEntries.length && !ordinaryAttributes.length && <p className="empty">No general attributes</p>}
            </div>

            {propertyEntries.length > 0 && (
              <div className="property-group">
                <h3>IFC property & quantity sets <span>{propertyEntries.length}</span></h3>
                <div className="property-set-groups">
                  {propertyGroups.map(([groupName, properties]) => (
                    <section className="property-set-group" key={groupName}>
                      <div className="property-set-title"><strong>{groupName}</strong><span>{properties.length}</span></div>
                      <div className="property-cards">
                        {properties.map((property) => (
                          <div className="property-card" key={property.id} title={property.id}>
                            <div className="property-card-head">
                              <strong>{property.name}</strong>
                              <i>OPM L{property.level}</i>
                            </div>
                            <div className="property-value">
                              <b title={property.value}>{property.value}</b>
                              {property.unit && <em>{property.unit}</em>}
                            </div>
                            {(property.generatedAt || property.datatype) && (
                              <div className="property-meta">
                                {property.generatedAt && <span><Clock3 size={10} />Current state · {new Date(property.generatedAt).toLocaleString()}</span>}
                                {property.datatype && <code>{property.datatype}</code>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}

            <div className="property-group">
              <h3>All links <span>{selectedLinks.length}</span></h3>
              {selectedLinks.map(({ quad, neighborId, direction }, index) => (
                <button className="connection-row link-row" key={`${direction}-${quad.predicate.value}-${neighborId}-${index}`} onClick={() => jumpTo(neighborId)}>
                  <span className={`link-category category-${quadLinkCategory(quad, model!.resources)}`} title={prettify(quadLinkCategory(quad, model!.resources))} />
                  <span className="link-copy">
                    <strong>{model!.resources.get(neighborId)?.label}</strong>
                    <small>{direction === 'incoming' ? '←' : '→'} {prettify(localName(quad.predicate.value))}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
              {!selectedLinks.length && <p className="empty">No resource links</p>}
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
