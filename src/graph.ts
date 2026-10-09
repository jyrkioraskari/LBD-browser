import { DataFactory, Parser, type Quad, type Term } from 'n3';

export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
export const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
export const BOT = 'https://w3id.org/bot#';
export const OMG_HAS_GEOMETRY = 'https://w3id.org/omg#hasGeometry';
export const FOG_AS_OBJ = 'https://w3id.org/fog#asObj_v3.0-obj';
export const OPM = 'https://w3id.org/opm#';
export const SCHEMA_VALUE = 'http://schema.org/value';
export const PROV_GENERATED_AT = 'http://www.w3.org/ns/prov#generatedAtTime';

export type LinkCategory = 'topology' | 'geometry' | 'properties' | 'other';
export type LinkFilter = 'all' | LinkCategory;

const GEOMETRY_NAMESPACES = ['https://w3id.org/omg#', 'https://w3id.org/fog#'];
const PROPERTY_NAMESPACES = ['https://w3id.org/props#'];
const BSDD_META = 'https://w3id.org/ifc2lbd/bsdd-meta#';

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
  virtualPropertySet?: boolean;
  propertyEntries?: PropertyEntry[];
}

export interface GraphModel {
  quads: Quad[];
  resources: Map<string, Resource>;
  prefixes: Prefixes;
  rootId: string;
}

export interface PropertyEntry {
  id: string;
  name: string;
  setName?: string;
  value: string;
  unit?: string;
  datatype?: string;
  generatedAt?: string;
  level: 1 | 2 | 3;
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
  const outgoingById = new Map<string, Quad[]>();
  const incomingById = new Map<string, Quad[]>();
  const add = (index: Map<string, Quad[]>, id: string, quad: Quad) => {
    const values = index.get(id);
    if (values) values.push(quad);
    else index.set(id, [quad]);
  };
  for (const quad of quads) {
    if (isResource(quad.subject)) {
      ids.add(quad.subject.value);
      add(outgoingById, quad.subject.value, quad);
    }
    if (isResource(quad.object) && quad.predicate.value !== RDF_TYPE) {
      ids.add(quad.object.value);
      add(incomingById, quad.object.value, quad);
    }
  }

  const resources = new Map<string, Resource>();
  for (const id of ids) {
    const outgoing = outgoingById.get(id) ?? [];
    const incoming = incomingById.get(id) ?? [];
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

  materializePropertySetGroups(resources, quads);

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
  const componentSizes = new Map<string, number>();
  const visited = new Set<string>();
  for (const id of resources.keys()) {
    if (visited.has(id)) continue;
    const members: string[] = [];
    const queue = [id];
    visited.add(id);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      members.push(current);
      for (const neighbor of connectedIds(current, resources)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    for (const member of members) componentSizes.set(member, members.length);
  }
  return [...candidates].sort((a, b) => {
    const reachDifference = (componentSizes.get(b.id) ?? 0) - (componentSizes.get(a.id) ?? 0);
    if (reachDifference) return reachDifference;
    return b.outgoing.length - a.outgoing.length;
  })[0];
}

export function linkCategory(predicate: string): LinkCategory {
  const name = localName(predicate);
  if (GEOMETRY_NAMESPACES.some((namespace) => predicate.startsWith(namespace))
    || /^(?:containsElement|interfaceOf|adjacentElement)$/i.test(name)
    || /(?:geometry|geometric|representation|mesh|shape|boundingBox)/i.test(name)) {
    return 'geometry';
  }
  if (predicate.startsWith(BOT)
    || /^(?:hasBuilding|hasStorey|hasSpace|intersectsZone|containsZone)$/i.test(name)) {
    return 'topology';
  }
  if (PROPERTY_NAMESPACES.some((namespace) => predicate.startsWith(namespace))
    || predicate.startsWith(BSDD_META)
    || isPropertySetName(predicate)
    || /(?:property|attribute|quantity|classification|material)/i.test(name)) {
    return 'properties';
  }
  return 'other';
}

export function quadLinkCategory(quad: Quad, resources: Map<string, Resource>): LinkCategory {
  const subject = resources.get(quad.subject.value);
  const object = isResource(quad.object) ? resources.get(quad.object.value) : undefined;
  if ((subject && isPropertySetResource(subject)) || (object && isPropertySetResource(object))
    || subject?.types.some((type) => type === `${OPM}Property` || type === `${OPM}CurrentPropertyState`)
    || object?.types.some((type) => type === `${OPM}Property` || type === `${OPM}CurrentPropertyState`)) {
    return 'properties';
  }
  return linkCategory(quad.predicate.value);
}

function isNavigationBackbone(predicate: string) {
  return /^(?:hasBuilding|hasStorey|hasSpace)$/i.test(localName(predicate));
}

function matchesQuadLinkFilter(quad: Quad, resources: Map<string, Resource>, filter: LinkFilter): boolean {
  const subject = resources.get(quad.subject.value);
  const object = isResource(quad.object) ? resources.get(quad.object.value) : undefined;
  if (subject?.virtualPropertySet || object?.virtualPropertySet) return filter === 'properties';
  if (isAttributePredicate(quad.predicate.value, resources)) return false;
  if (isNavigationBackbone(quad.predicate.value)) return true;
  if (filter === 'all' || quadLinkCategory(quad, resources) === filter) return true;
  return filter === 'geometry'
    && /^(?:hasBuilding|hasStorey|hasSpace|containsZone|hasSubElement)$/i.test(localName(quad.predicate.value));
}

export function matchesLinkFilter(predicate: string, filter: LinkFilter): boolean {
  if (filter === 'all' || linkCategory(predicate) === filter) return true;
  if (filter === 'geometry') {
    // Keep the spatial backbone visible so a geometry-only traversal can reach
    // elements and their OMG/FOG representations from a Site or Building root.
    return /^(?:hasBuilding|hasStorey|hasSpace|containsZone|hasSubElement)$/i.test(localName(predicate));
  }
  return false;
}

export function connectedIds(
  id: string,
  resources: Map<string, Resource>,
  filter: LinkFilter = 'all',
): Set<string> {
  const resource = resources.get(id);
  if (!resource) return new Set();
  const ids = new Set<string>();
  for (const quad of resource.outgoing) {
    if (quad.predicate.value !== RDF_TYPE && matchesQuadLinkFilter(quad, resources, filter)
      && isResource(quad.object) && resources.has(quad.object.value)) ids.add(quad.object.value);
  }
  for (const quad of resource.incoming) {
    if (matchesQuadLinkFilter(quad, resources, filter)) ids.add(quad.subject.value);
  }
  return ids;
}

function isPropertySetName(value: string): boolean {
  const name = localName(value);
  return /^(?:pset_|qto_)/i.test(name) || /(?:property|quantity)set/i.test(name);
}

export function isPropertySetResource(resource: Resource): boolean {
  if (resource.types.includes(`${OPM}Property`) || resource.types.includes(`${OPM}CurrentPropertyState`)) return false;
  return Boolean(resource.propertySet)
    || isPropertySetName(resource.id)
    || isPropertySetName(resource.label)
    || resource.types.some(isPropertySetName);
}

export function isQuantitySetResource(resource: Resource): boolean {
  const names = [resource.id, resource.label, ...resource.types].map(localName);
  return names.some((name) => /^qto_/i.test(name) || /quantityset/i.test(name));
}

function literalValue(resource: Resource, predicate: (name: string, uri: string) => boolean) {
  return resource.outgoing.find((quad) => quad.object.termType === 'Literal'
    && predicate(localName(quad.predicate.value), quad.predicate.value));
}

function objectValue(resource: Resource, predicate: (name: string, uri: string) => boolean) {
  return resource.outgoing.find((quad) => isResource(quad.object)
    && predicate(localName(quad.predicate.value), quad.predicate.value));
}

function propertyLabel(resource: Resource, fallback: string) {
  const label = resource.label && resource.label !== prettify(localName(resource.id))
    ? resource.label
    : prettify(localName(fallback));
  const separator = label.indexOf(':');
  return separator > 0
    ? { setName: label.slice(0, separator), name: prettify(label.slice(separator + 1)) }
    : { name: prettify(label.replace(/_(?:property_)?simple$/i, '')) };
}

export function isAttributePredicate(predicate: string, resources: Map<string, Resource>) {
  if (/_attribute_simple$/i.test(localName(predicate))) return true;
  return resources.get(predicate)?.outgoing.some((quad) =>
    quad.predicate.value === RDFS_COMMENT
    && quad.object.termType === 'Literal'
    && /^IFC standard attribute\s+/i.test(quad.object.value)) ?? false;
}

function opmPropertyEntry(
  property: Resource,
  relationPredicate: string,
  resources: Map<string, Resource>,
  inheritedSetName?: string,
): PropertyEntry | undefined {
  const stateLink = objectValue(property, (name, uri) => uri === `${OPM}hasPropertyState` || name === 'hasPropertyState');
  const state = stateLink ? resources.get(stateLink.object.value) : undefined;
  const valueOwner = state ?? property;
  const value = literalValue(valueOwner, (name, uri) => uri === SCHEMA_VALUE || name === 'value');
  if (!value) return undefined;
  const unit = objectValue(valueOwner, (name) => name === 'unit')
    ?? objectValue(property, (name) => name === 'unit');
  const originalUnit = literalValue(valueOwner, (name) => name === 'originalUnitCode')
    ?? literalValue(property, (name) => name === 'originalUnitCode');
  const generatedAt = state
    ? literalValue(state, (name, uri) => uri === PROV_GENERATED_AT || name === 'generatedAtTime')
    : undefined;
  const label = propertyLabel(property, relationPredicate);
  const literal = value.object.termType === 'Literal' ? value.object : undefined;
  return {
    id: property.id,
    name: label.name,
    setName: inheritedSetName ?? label.setName,
    value: value.object.value,
    unit: originalUnit?.object.value ?? (unit ? prettify(localName(unit.object.value)) : undefined),
    datatype: literal?.datatype ? localName(literal.datatype.value) : undefined,
    generatedAt: generatedAt?.object.value,
    level: state ? 3 : 2,
  };
}

/** Normalizes IFCtoLBD OPM levels 1–3 and explicit property-set containers for the UI. */
export function propertyEntriesFor(resource: Resource, resources: Map<string, Resource>): PropertyEntry[] {
  if (resource.virtualPropertySet) return resource.propertyEntries ?? [];
  const entries: PropertyEntry[] = [];
  const seen = new Set<string>();

  if (isPropertySetResource(resource)) {
    const setName = resource.label || prettify(localName(resource.id));
    for (const propertyLink of resource.outgoing.filter((candidate) =>
      isResource(candidate.object) && /containsProperty/i.test(localName(candidate.predicate.value)))) {
      const property = resources.get(propertyLink.object.value);
      if (!property) continue;
      const entry = opmPropertyEntry(property, propertyLink.predicate.value, resources, setName);
      if (entry) { entries.push(entry); seen.add(property.id); }
    }
  }

  for (const quad of resource.outgoing) {
    if (!isAttributePredicate(quad.predicate.value, resources)
      && quad.object.termType === 'Literal'
      && (quad.predicate.value.startsWith('https://w3id.org/props#')
        || /(?:property_simple|quantity_simple)$/i.test(localName(quad.predicate.value)))) {
      const name = prettify(localName(quad.predicate.value)
        .replace(/_(?:property|attribute|quantity)_simple$/i, ''));
      const predicateResource = resources.get(quad.predicate.value);
      const declaredSetNames = predicateResource?.outgoing
        .filter((candidate) => candidate.predicate.value === RDFS_COMMENT && candidate.object.termType === 'Literal')
        .flatMap((candidate) => {
          const match = candidate.object.value.match(/IFC property set\s+(.+?)\s+property\s+/i);
          return match ? [match[1]] : [];
        }) ?? [];
      const uniqueSetNames = [...new Set(declaredSetNames)];
      const specificTypes = resource.types.map(localName)
        .filter((type) => !/^(?:Element|Zone|Product)$/i.test(type));
      const matchingSetNames = uniqueSetNames.filter((setName) => specificTypes.some((type) =>
        setName.toLocaleLowerCase().includes(type.toLocaleLowerCase())));
      const groups = matchingSetNames.length
        ? matchingSetNames
        : uniqueSetNames.length === 1 ? uniqueSetNames : [undefined];
      for (const setName of groups) {
        entries.push({
          id: `${resource.id}-${quad.predicate.value}-${setName ?? 'ungrouped'}`,
          name,
          setName,
          value: quad.object.value,
          datatype: quad.object.datatype ? localName(quad.object.datatype.value) : undefined,
          level: 1,
        });
      }
      continue;
    }
    if (!isResource(quad.object)) continue;
    if (isAttributePredicate(quad.predicate.value, resources)) continue;
    const target = resources.get(quad.object.value);
    if (!target) continue;

    if (isPropertySetResource(target)) {
      const setName = target.label || prettify(localName(target.id));
      for (const propertyLink of target.outgoing.filter((candidate) =>
        isResource(candidate.object) && /containsProperty/i.test(localName(candidate.predicate.value)))) {
        const property = resources.get(propertyLink.object.value);
        if (!property || seen.has(property.id)) continue;
        const entry = opmPropertyEntry(property, propertyLink.predicate.value, resources, setName);
        if (entry) { entries.push(entry); seen.add(property.id); }
      }
      continue;
    }

    const isOpmProperty = target.types.includes(`${OPM}Property`)
      || target.outgoing.some((candidate) => candidate.predicate.value === `${OPM}hasPropertyState`)
      || target.outgoing.some((candidate) => candidate.predicate.value === SCHEMA_VALUE);
    if (isOpmProperty && !seen.has(target.id)) {
      const entry = opmPropertyEntry(target, quad.predicate.value, resources);
      if (entry) { entries.push(entry); seen.add(target.id); }
    }
  }
  return entries;
}

/** Normalizes IFC attributes and folds OPM level 2/3 attribute resources into their owner. */
export function attributeEntriesFor(resource: Resource, resources: Map<string, Resource>): PropertyEntry[] {
  const entries: PropertyEntry[] = [];
  for (const quad of resource.outgoing) {
    if (!isAttributePredicate(quad.predicate.value, resources)) continue;
    const name = prettify(localName(quad.predicate.value).replace(/_attribute_simple$/i, '').replace(/Ifc\w*$/i, ''));
    if (quad.object.termType === 'Literal') {
      entries.push({
        id: `${resource.id}-${quad.predicate.value}-attribute`,
        name,
        value: quad.object.value,
        datatype: quad.object.datatype ? localName(quad.object.datatype.value) : undefined,
        level: 1,
      });
      continue;
    }
    if (!isResource(quad.object)) continue;
    const attribute = resources.get(quad.object.value);
    if (!attribute) continue;
    const entry = opmPropertyEntry(attribute, quad.predicate.value, resources);
    if (entry) entries.push({ ...entry, name });
  }
  return entries;
}

function materializePropertySetGroups(resources: Map<string, Resource>, quads: Quad[]) {
  const owners = [...resources.values()].filter((resource) =>
    !isPropertySetResource(resource)
    && !resource.types.some((type) => type === `${OPM}Property` || type === `${OPM}CurrentPropertyState`));

  for (const owner of owners) {
    const entries = propertyEntriesFor(owner, resources).filter((entry) => entry.setName);
    if (!entries.length) continue;
    const explicitSetNames = new Set(owner.outgoing.flatMap((quad) => {
      if (!isResource(quad.object)) return [];
      const target = resources.get(quad.object.value);
      return target && isPropertySetResource(target) ? [target.label] : [];
    }));
    const groups = new Map<string, PropertyEntry[]>();
    for (const entry of entries) {
      const setName = entry.setName!;
      if (explicitSetNames.has(setName)) continue;
      const group = groups.get(setName) ?? [];
      group.push(entry);
      groups.set(setName, group);
    }

    for (const [setName, propertyEntries] of groups) {
      const id = `urn:lbd-browser:property-set:${encodeURIComponent(owner.id)}:${encodeURIComponent(setName)}`;
      const link = DataFactory.quad(
        DataFactory.namedNode(owner.id),
        DataFactory.namedNode(`${BSDD_META}hasPropertySet`),
        DataFactory.namedNode(id),
      );
      const propertySet: Resource = {
        id,
        types: [`${BSDD_META}PropertySet`],
        label: setName,
        outgoing: [],
        incoming: [link],
        properties: [],
        propertySet: true,
        virtualPropertySet: true,
        propertyEntries,
      };
      resources.set(id, propertySet);
      owner.outgoing.push(link);
      quads.push(link);
    }
  }
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
  filter: LinkFilter = 'all',
): Set<string> {
  const resource = resources.get(id);
  if (!resource) return new Set();
  const collapsePropertySetContents = filter === 'properties' && isPropertySetResource(resource);

  const byPredicate = new Map<string, Set<string>>();
  const addConnection = (quad: Quad, neighbor: string) => {
    const predicate = quad.predicate.value;
    if (collapsePropertySetContents && /^containsProperty$/i.test(localName(predicate))) return;
    if (filter === 'properties' && isAttributePredicate(predicate, resources)) return;
    if (!resources.has(neighbor) || !matchesQuadLinkFilter(quad, resources, filter)) return;
    const neighbors = byPredicate.get(predicate) ?? new Set<string>();
    neighbors.add(neighbor);
    byPredicate.set(predicate, neighbors);
  };

  for (const quad of resource.outgoing) {
    if (quad.predicate.value !== RDF_TYPE && isResource(quad.object)) {
      addConnection(quad, quad.object.value);
    }
  }
  for (const quad of resource.incoming) {
    addConnection(quad, quad.subject.value);
  }

  const connected = filter === 'properties'
    ? new Set([...byPredicate.values()].flatMap((neighbors) => [...neighbors]))
    : connectedIds(id, resources, filter);
  const propertySets = propertySetConnectionIds(id, resources);
  if (filter === 'all') return connected;
  const graphConnections = filter === 'properties'
    ? connected
    : new Set([...connected].filter((neighbor) => !propertySets.has(neighbor)));
  if (filter === 'properties' && propertySets.size) {
    const result = new Set(propertySets);
    for (const [predicate, neighbors] of byPredicate) {
      if (isNavigationBackbone(predicate)) {
        for (const neighbor of neighbors) result.add(neighbor);
      }
    }
    return result;
  }
  if (filter === 'geometry') return graphConnections;
  if (filter === 'topology') {
    const storeys = new Set<string>();
    for (const [predicate, neighbors] of byPredicate) {
      if (/^hasStorey$/i.test(localName(predicate))) {
        for (const neighbor of neighbors) storeys.add(neighbor);
      }
    }
    if (storeys.size) {
      const result = new Set(storeys);
      const targetSize = Math.max(limit, storeys.size);
      for (const neighbor of graphConnections) {
        if (result.size >= targetSize) break;
        result.add(neighbor);
      }
      return result;
    }
  }
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

export function expansionAfterClick(id: string, current: Set<string>, preserveBranches = false): Set<string> {
  if (preserveBranches) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (current.size === 1 && current.has(id)) return new Set();
  return new Set([id]);
}

export function distancesFrom(
  startId: string,
  resources: Map<string, Resource>,
  filter: LinkFilter = 'all',
  maxDistance = Infinity,
): Map<string, number> {
  const distances = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const distance = distances.get(current)!;
    if (distance >= maxDistance) continue;
    for (const neighbor of connectedIds(current, resources, filter)) {
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
  filter: LinkFilter = 'all',
): Set<string> {
  const distances = distancesFrom(focusId, resources, filter, radius);
  const visible = new Set<string>([focusId]);
  for (const expandedId of expandedIds) {
    if ((distances.get(expandedId) ?? Infinity) > radius) continue;
    visible.add(expandedId);
    for (const neighbor of expansionConnectedIds(expandedId, resources, 10, filter)) {
      if ((distances.get(neighbor) ?? Infinity) <= radius) visible.add(neighbor);
    }
  }
  return visible;
}

export function graphEdges(model: GraphModel, visible: Set<string>, filter: LinkFilter = 'all') {
  const edges: Quad[] = [];
  for (const id of visible) {
    const resource = model.resources.get(id);
    if (!resource) continue;
    for (const quad of resource.outgoing) {
      if (quad.predicate.value !== RDF_TYPE
        && matchesQuadLinkFilter(quad, model.resources, filter)
        && isResource(quad.object)
        && visible.has(quad.object.value)) edges.push(quad);
    }
  }
  return edges;
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
