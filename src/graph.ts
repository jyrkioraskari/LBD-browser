import { Parser, type Quad, type Term } from 'n3';

export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
export const BOT = 'https://w3id.org/bot#';
export const OMG_HAS_GEOMETRY = 'https://w3id.org/omg#hasGeometry';
export const FOG_AS_OBJ = 'https://w3id.org/fog#asObj_v3.0-obj';

export type Prefixes = Record<string, string>;

export interface Resource {
  id: string;
  types: string[];
  label: string;
  outgoing: Quad[];
  incoming: Quad[];
  properties: Quad[];
  geometryObj?: string;
  propertySet?: boolean;
}

export interface GraphModel {
  quads: Quad[];
  resources: Map<string, Resource>;
  prefixes: Prefixes;
  rootId: string;
}

export function parseTurtle(source: string): Promise<GraphModel> {
  return new Promise((resolve, reject) => {
    const parser = new Parser({ baseIRI: 'https://local.lbd/' });
    const quads: Quad[] = [];
    parser.parse(source, (error, quad, prefixes) => {
      if (error) {
        reject(error);
        return;
      }
      if (quad) {
        quads.push(quad);
        return;
      }
      try {
        const prefixStrings = Object.fromEntries(
          Object.entries(prefixes).map(([prefix, namespace]) => [prefix, namespace.value]),
        );
        resolve(buildModel(quads, prefixStrings));
      } catch (buildError) {
        reject(buildError);
      }
    });
  });
}

export function buildModel(quads: Quad[], prefixes: Prefixes = {}): GraphModel {
  const ids = new Set<string>();
  for (const quad of quads) {
    if (isResource(quad.subject)) ids.add(quad.subject.value);
    if (isResource(quad.object) && quad.predicate.value !== RDF_TYPE) ids.add(quad.object.value);
  }

  const resources = new Map<string, Resource>();
  for (const id of ids) {
    const outgoing = quads.filter((quad) => quad.subject.value === id);
    const incoming = quads.filter(
      (quad) => isResource(quad.object) && quad.object.value === id && quad.predicate.value !== RDF_TYPE,
    );
    const types = outgoing.filter((quad) => quad.predicate.value === RDF_TYPE).map((quad) => quad.object.value);
    const labelQuad = outgoing.find((quad) => quad.predicate.value === RDFS_LABEL)
      ?? outgoing.find((quad) => /(?:nameIfcRoot|name|label)/i.test(localName(quad.predicate.value)) && quad.object.termType === 'Literal');
    resources.set(id, {
      id,
      types,
      label: labelQuad?.object.value || prettify(localName(id)),
      outgoing,
      incoming,
      properties: outgoing.filter((quad) =>
        quad.object.termType === 'Literal' && quad.predicate.value !== FOG_AS_OBJ),
    });
  }

  const objBySubject = new Map<string, string>();
  for (const quad of quads) {
    if (quad.predicate.value === FOG_AS_OBJ && quad.object.termType === 'Literal') {
      objBySubject.set(quad.subject.value, quad.object.value);
    }
  }
  for (const resource of resources.values()) {
    const geometryIds = resource.outgoing
      .filter((quad) => quad.predicate.value === OMG_HAS_GEOMETRY && isResource(quad.object))
      .map((quad) => quad.object.value);
    const geometrySubjects = [resource.id, ...geometryIds];
    const geometryObj = geometrySubjects.map((id) => objBySubject.get(id)).find(Boolean);
    if (geometryObj) resource.geometryObj = geometryObj;
  }

  if (!resources.size) throw new Error('No RDF resources were found in this Turtle document.');

  for (const quad of quads) {
    if (isPropertySetName(quad.predicate.value) && isResource(quad.object)) {
      const propertySet = resources.get(quad.object.value);
      if (propertySet) propertySet.propertySet = true;
    }
  }

  const rootId = chooseRoot(resources);
  return { quads, resources, prefixes, rootId };
}

export function chooseRoot(resources: Map<string, Resource>): string {
  const candidates = [...resources.values()];
  const sites = candidates.filter((resource) => resource.types.includes(`${BOT}Site`));
  if (sites.length) return largestReach(sites, resources).id;

  const buildingElements = candidates.filter((resource) =>
    resource.types.some((type) => type === `${BOT}Building` || type === `${BOT}Element` || type === `${BOT}Zone`),
  );
  const pool = buildingElements.length ? buildingElements : candidates;
  const topological = pool.filter((resource) => resource.incoming.length === 0);
  return largestReach(topological.length ? topological : pool, resources).id;
}

function largestReach(candidates: Resource[], resources: Map<string, Resource>): Resource {
  return [...candidates].sort((a, b) => {
    const reachDifference = reachableCount(b.id, resources) - reachableCount(a.id, resources);
    if (reachDifference) return reachDifference;
    return b.outgoing.length - a.outgoing.length;
  })[0];
}

function reachableCount(startId: string, resources: Map<string, Resource>): number {
  return distancesFrom(startId, resources).size;
}

export function connectedIds(id: string, resources: Map<string, Resource>): Set<string> {
  const resource = resources.get(id);
  if (!resource) return new Set();
  const ids = new Set<string>();
  for (const quad of resource.outgoing) {
    if (quad.predicate.value !== RDF_TYPE && isResource(quad.object) && resources.has(quad.object.value)) ids.add(quad.object.value);
  }
  for (const quad of resource.incoming) ids.add(quad.subject.value);
  return ids;
}

function isPropertySetName(value: string): boolean {
  return /^pset_/i.test(localName(value)) || /propertyset/i.test(localName(value));
}

export function isPropertySetResource(resource: Resource): boolean {
  return Boolean(resource.propertySet)
    || isPropertySetName(resource.id)
    || isPropertySetName(resource.label)
    || resource.types.some(isPropertySetName);
}

export function isBuildingElementResource(resource: Resource): boolean {
  return resource.types.some((type) => {
    const name = localName(type);
    return name === 'Element'
      || /buildingelement/i.test(name)
      || /^Ifc(?:Wall|Slab|Beam|Column|Door|Window|Roof|Stair|Railing|Member|Plate|Footing|Pile|Covering|CurtainWall)/i.test(name);
  });
}

export function propertySetConnectionIds(id: string, resources: Map<string, Resource>): Set<string> {
  const resource = resources.get(id);
  if (!resource) return new Set();
  const ids = new Set<string>();
  const addIfPropertySet = (predicate: string, neighborId: string) => {
    const neighbor = resources.get(neighborId);
    if (isPropertySetName(predicate) || (neighbor && isPropertySetResource(neighbor))) ids.add(neighborId);
  };
  for (const quad of resource.outgoing) {
    if (quad.predicate.value !== RDF_TYPE && isResource(quad.object)) {
      addIfPropertySet(quad.predicate.value, quad.object.value);
    }
  }
  for (const quad of resource.incoming) addIfPropertySet(quad.predicate.value, quad.subject.value);
  return ids;
}

export function expansionConnectedIds(
  id: string,
  resources: Map<string, Resource>,
  limit = 10,
): Set<string> {
  const resource = resources.get(id);
  if (!resource) return new Set();

  const byPredicate = new Map<string, Set<string>>();
  const addConnection = (predicate: string, neighbor: string) => {
    if (!resources.has(neighbor)) return;
    const neighbors = byPredicate.get(predicate) ?? new Set<string>();
    neighbors.add(neighbor);
    byPredicate.set(predicate, neighbors);
  };

  for (const quad of resource.outgoing) {
    if (quad.predicate.value !== RDF_TYPE && isResource(quad.object)) {
      addConnection(quad.predicate.value, quad.object.value);
    }
  }
  for (const quad of resource.incoming) {
    addConnection(quad.predicate.value, quad.subject.value);
  }

  const connected = connectedIds(id, resources);
  const propertySets = propertySetConnectionIds(id, resources);
  const graphConnections = new Set([...connected].filter((neighbor) => !propertySets.has(neighbor)));
  if (graphConnections.size <= limit) return graphConnections;

  for (const neighbors of byPredicate.values()) {
    for (const propertySetId of propertySets) neighbors.delete(propertySetId);
  }

  const buildingElements = [...graphConnections]
    .filter((neighbor) => isBuildingElementResource(resources.get(neighbor)!));
  const expanded = new Set(buildingElements.slice(0, limit));
  if (expanded.size === limit) return expanded;

  for (const neighbors of byPredicate.values()) {
    for (const buildingElementId of buildingElements) neighbors.delete(buildingElementId);
  }

  const groups = [...byPredicate.entries()]
    .filter(([, neighbors]) => neighbors.size > 0)
    .sort((a, b) => a[1].size - b[1].size || a[0].localeCompare(b[0]));
  for (const [, neighbors] of groups) {
    const additions = [...neighbors].filter((neighbor) => !expanded.has(neighbor));
    if (expanded.size + additions.length > limit) continue;
    additions.forEach((neighbor) => expanded.add(neighbor));
  }
  if (!expanded.size) {
    const fallback = [...connected]
      .filter((neighbor) => !propertySets.has(neighbor))
      .sort((a, b) =>
        Number(isBuildingElementResource(resources.get(b)!)) - Number(isBuildingElementResource(resources.get(a)!)));
    return new Set(fallback.slice(0, limit));
  }
  return expanded;
}

export function expansionAfterClick(id: string, current: Set<string>): Set<string> {
  if (current.size === 1 && current.has(id)) return new Set();
  return new Set([id]);
}

export function distancesFrom(startId: string, resources: Map<string, Resource>): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const distance = distances.get(current)!;
    for (const neighbor of connectedIds(current, resources)) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

export function deriveVisible(
  focusId: string,
  expandedIds: Set<string>,
  resources: Map<string, Resource>,
  radius: number,
): Set<string> {
  const distances = distancesFrom(focusId, resources);
  const visible = new Set<string>([focusId]);
  for (const expandedId of expandedIds) {
    if ((distances.get(expandedId) ?? Infinity) > radius) continue;
    visible.add(expandedId);
    for (const neighbor of expansionConnectedIds(expandedId, resources)) {
      if ((distances.get(neighbor) ?? Infinity) <= radius) visible.add(neighbor);
    }
  }
  return visible;
}

export function graphEdges(model: GraphModel, visible: Set<string>) {
  return model.quads.filter((quad) =>
    quad.predicate.value !== RDF_TYPE
    && visible.has(quad.subject.value)
    && isResource(quad.object)
    && visible.has(quad.object.value),
  );
}

export function localName(uri: string): string {
  const clean = uri.replace(/[\/#]+$/, '');
  return decodeURIComponent(clean.slice(Math.max(clean.lastIndexOf('#'), clean.lastIndexOf('/')) + 1));
}

export function compactUri(uri: string, prefixes: Prefixes): string {
  const match = Object.entries(prefixes)
    .filter(([, namespace]) => uri.startsWith(namespace))
    .sort((a, b) => b[1].length - a[1].length)[0];
  return match ? `${match[0]}:${uri.slice(match[1].length)}` : uri;
}

export function prettify(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

export function resourceKind(resource: Resource): 'site' | 'building' | 'storey' | 'space' | 'element' | 'resource' {
  const typeNames = resource.types.map(localName);
  if (typeNames.includes('Site')) return 'site';
  if (typeNames.includes('Building')) return 'building';
  if (typeNames.includes('Storey')) return 'storey';
  if (typeNames.includes('Space')) return 'space';
  if (typeNames.includes('Element')) return 'element';
  return 'resource';
}

function isResource(term: Term): boolean {
  return term.termType === 'NamedNode' || term.termType === 'BlankNode';
}
