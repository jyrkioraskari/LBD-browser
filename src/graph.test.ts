import { describe, expect, it } from 'vitest';
import { createObjPreview } from './geometry';
import {
  connectedIds,
  deriveVisible,
  expansionAfterClick,
  expansionConnectedIds,
  graphEdges,
  linkCategory,
  parseTurtle,
  propertyEntriesFor,
  quadLinkCategory,
  propertySetConnectionIds,
} from './graph';

const ttl = `@prefix bot: <https://w3id.org/bot#> . @prefix ex: <https://example.test/> .
ex:site a bot:Site ; bot:hasBuilding ex:building .
ex:building a bot:Building ; ex:name "Main building" ; ex:reference "A-01" ; bot:hasStorey ex:storey .
ex:storey a bot:Storey ; bot:containsElement ex:wall .
ex:wall a bot:Element .`;

describe('LBD graph model', () => {
  it('selects a bot:Site as its root', async () => {
    const model = await parseTurtle(ttl);
    expect(model.rootId).toBe('https://example.test/site');
    expect(connectedIds(model.rootId, model.resources)).toEqual(new Set(['https://example.test/building']));
  });

  it('keeps the visible graph near the most recent focus', async () => {
    const model = await parseTurtle(ttl);
    const expanded = new Set([
      'https://example.test/site',
      'https://example.test/building',
      'https://example.test/storey',
    ]);
    const visible = deriveVisible('https://example.test/storey', expanded, model.resources, 1);
    expect([...visible]).toEqual(expect.arrayContaining([
      'https://example.test/building',
      'https://example.test/storey',
      'https://example.test/wall',
    ]));
    expect(visible.has('https://example.test/site')).toBe(false);
  });

  it('keeps all literal attributes on their connected resource', async () => {
    const model = await parseTurtle(ttl);
    const building = model.resources.get('https://example.test/building');

    expect(building?.properties.map((quad) => quad.object.value)).toEqual([
      'Main building',
      'A-01',
    ]);
  });

  it('prioritizes uncommon connection properties when expansion exceeds ten nodes', async () => {
    const commonConnections = Array.from({ length: 12 }, (_, index) => `ex:common_${index}`).join(', ');
    const crowdedTtl = `@prefix ex: <https://example.test/> .
      ex:hub ex:common ${commonConnections} ; ex:rare ex:rare_1, ex:rare_2 .`;
    const model = await parseTurtle(crowdedTtl);

    expect([...expansionConnectedIds('https://example.test/hub', model.resources)]).toEqual([
      'https://example.test/rare_1',
      'https://example.test/rare_2',
    ]);
    expect(deriveVisible(
      'https://example.test/hub',
      new Set(['https://example.test/hub']),
      model.resources,
      1,
    )).toEqual(new Set([
      'https://example.test/hub',
      'https://example.test/rare_1',
      'https://example.test/rare_2',
    ]));
  });

  it('still opens a capped subset when every connection uses one common property', async () => {
    const connections = Array.from({ length: 12 }, (_, index) => `ex:item_${index}`).join(', ');
    const crowdedTtl = `@prefix ex: <https://example.test/> . ex:hub ex:common ${connections} .`;
    const model = await parseTurtle(crowdedTtl);

    expect(expansionConnectedIds('https://example.test/hub', model.resources).size).toBe(10);
  });

  it('keeps exactly one active expansion and toggles that node on repeated clicks', () => {
    expect(expansionAfterClick('b', new Set(['a']))).toEqual(new Set(['b']));
    expect(expansionAfterClick('b', new Set(['a', 'b']))).toEqual(new Set(['b']));
    expect(expansionAfterClick('b', new Set(['b']))).toEqual(new Set());
  });

  it('preserves the expanded spatial path while navigating topology', () => {
    expect(expansionAfterClick('storey', new Set(['site', 'building']), true)).toEqual(
      new Set(['site', 'building', 'storey']),
    );
    expect(expansionAfterClick('storey', new Set(['building', 'storey']), true)).toEqual(
      new Set(['building']),
    );
  });

  it('never caps hasStorey links in the topology lens', async () => {
    const storeys = Array.from({ length: 14 }, (_, index) => `ex:storey_${index}`).join(', ');
    const model = await parseTurtle(`
      @prefix bot: <https://w3id.org/bot#> .
      @prefix ex: <https://example.test/> .
      ex:building a bot:Building ; bot:hasStorey ${storeys} .`);

    expect(expansionConnectedIds(
      'https://example.test/building', model.resources, 10, 'topology',
    ).size).toBe(14);
  });

  it('does not cap adjacent elements or interfaces in the geometry lens', async () => {
    const adjacent = Array.from({ length: 14 }, (_, index) => `ex:element_${index}`).join(', ');
    const model = await parseTurtle(`
      @prefix bot: <https://w3id.org/bot#> .
      @prefix ex: <https://example.test/> .
      ex:space a bot:Space ; bot:adjacentElement ${adjacent} .
      ex:interface a bot:Interface ; bot:interfaceOf ex:space, ex:element_0 .`);

    const visible = expansionConnectedIds('https://example.test/space', model.resources, 10, 'geometry');
    expect(visible.size).toBe(15);
    expect(visible).toContain('https://example.test/interface');
    expect(visible).toContain('https://example.test/element_13');
  });

  it('keeps large property-set collections out of expansion and favors elements', async () => {
    const propertySets = Array.from({ length: 11 }, (_, index) => `ex:pset_${index}`).join(', ');
    const psetTtl = `
      @prefix bot: <https://w3id.org/bot#> .
      @prefix ex: <https://example.test/> .
      ex:wall ex:Pset_WallCommon ${propertySets} ; ex:related ex:beam, ex:note .
      ex:beam a bot:Element .`;
    const model = await parseTurtle(psetTtl);
    const wallId = 'https://example.test/wall';
    const expanded = [...expansionConnectedIds(wallId, model.resources)];

    expect(propertySetConnectionIds(wallId, model.resources).size).toBe(11);
    expect(expanded).toContain('https://example.test/beam');
    expect(expanded.some((id) => id.includes('pset_'))).toBe(false);
  });

  it('keeps even a single property-set connection out of the graph', async () => {
    const model = await parseTurtle(`
      @prefix bot: <https://w3id.org/bot#> .
      @prefix ex: <https://example.test/> .
      ex:wall ex:Pset_WallCommon ex:pset ; ex:related ex:beam .
      ex:beam a bot:Element .`);

    expect(expansionConnectedIds('https://example.test/wall', model.resources)).toEqual(
      new Set(['https://example.test/beam']),
    );
  });

  it('always gives building elements priority when expansion is capped', async () => {
    const elements = Array.from({ length: 12 }, (_, index) => `ex:element_${index}`);
    const elementTypes = elements.map((element) => `${element} a bot:Element .`).join('\n');
    const model = await parseTurtle(`
      @prefix bot: <https://w3id.org/bot#> .
      @prefix ex: <https://example.test/> .
      ex:storey ex:contains ${elements.join(', ')} ; ex:rare ex:note_1, ex:note_2 .
      ${elementTypes}`);
    const expanded = [...expansionConnectedIds('https://example.test/storey', model.resources)];

    expect(expanded).toHaveLength(10);
    expect(expanded.every((id) => id.includes('/element_'))).toBe(true);
  });

  it('associates embedded OBJ geometry with its owning building element', async () => {
    const encodedObj = btoa('v 0 0 0\nv 1 0 0\nv 0 1 1\nf 1 2 3');
    const geometryTtl = `
      @prefix bot: <https://w3id.org/bot#> .
      @prefix omg: <https://w3id.org/omg#> .
      @prefix fog: <https://w3id.org/fog#> .
      @prefix ex: <https://example.test/> .
      ex:wall a bot:Element ; omg:hasGeometry ex:wall_geometry .
      ex:wall_geometry fog:asObj_v3.0-obj "${encodedObj}" .`;
    const model = await parseTurtle(geometryTtl);

    expect(model.resources.get('https://example.test/wall')?.geometryObj).toBe(encodedObj);
    expect(model.resources.get('https://example.test/wall_geometry')?.properties).toEqual([]);
    expect(createObjPreview(encodedObj)?.path).toContain('M');
  });

  it('classifies link predicates by navigation purpose', () => {
    expect(linkCategory('https://w3id.org/bot#hasBuilding')).toBe('topology');
    expect(linkCategory('https://w3id.org/bot#containsElement')).toBe('geometry');
    expect(linkCategory('https://w3id.org/bot#interfaceOf')).toBe('geometry');
    expect(linkCategory('https://w3id.org/bot#adjacentElement')).toBe('geometry');
    expect(linkCategory('https://w3id.org/omg#hasGeometry')).toBe('geometry');
    expect(linkCategory('https://w3id.org/props#Pset_WallCommon')).toBe('properties');
    expect(linkCategory('https://example.test/relatedTo')).toBe('other');
  });

  it('filters traversal and graph edges with the same relation lens', async () => {
    const model = await parseTurtle(`
      @prefix bot: <https://w3id.org/bot#> .
      @prefix omg: <https://w3id.org/omg#> .
      @prefix props: <https://w3id.org/props#> .
      @prefix ex: <https://example.test/> .
      ex:building a bot:Building ; bot:hasStorey ex:storey ; omg:hasGeometry ex:geometry ; props:Pset_Building ex:pset .`);
    const building = 'https://example.test/building';
    const visible = deriveVisible(building, new Set([building]), model.resources, 1, 'geometry');

    expect(visible).toEqual(new Set([
      building,
      'https://example.test/storey',
      'https://example.test/geometry',
    ]));
    expect(graphEdges(model, visible, 'geometry')).toHaveLength(2);
    expect(expansionConnectedIds(building, model.resources, 10, 'properties')).toEqual(
      new Set(['https://example.test/pset']),
    );
  });

  it('normalizes IFCtoLBD OPM levels into intuitive property entries', async () => {
    const model = await parseTurtle(`
      @prefix ex: <https://example.test/> .
      @prefix props: <https://w3id.org/props#> .
      @prefix opm: <https://w3id.org/opm#> .
      @prefix schema: <http://schema.org/> .
      @prefix prov: <http://www.w3.org/ns/prov#> .
      ex:wall props:reference_property_simple "A-01" ;
        props:loadBearing ex:load ; props:fireRating ex:fire .
      ex:load a opm:Property ; schema:value true .
      ex:fire a opm:Property ; <http://www.w3.org/2000/01/rdf-schema#label> "Pset_WallCommon:FireRating" ;
        opm:hasPropertyState ex:fireState .
      ex:fireState a opm:CurrentPropertyState ; schema:value "EI60" ;
        prov:generatedAtTime "2026-10-08T10:00:00Z" .
      props:reference_property_simple <http://www.w3.org/2000/01/rdf-schema#comment>
        "IFC property set Pset_IdentityData property Reference" .`);
    const entries = propertyEntriesFor(model.resources.get('https://example.test/wall')!, model.resources);

    expect(entries.map((entry) => [entry.name, entry.value, entry.level])).toEqual([
      ['Reference', 'A-01', 1],
      ['Load Bearing', 'true', 2],
      ['Fire Rating', 'EI60', 3],
    ]);
    expect(entries[2].setName).toBe('Pset_WallCommon');
    expect(entries[2].generatedAt).toBe('2026-10-08T10:00:00Z');
    expect(entries[0].setName).toBe('Pset_IdentityData');
  });

  it('classifies links by their property-set target even with a custom predicate', async () => {
    const model = await parseTurtle(`
      @prefix ex: <https://example.test/> .
      @prefix bsddm: <https://w3id.org/ifc2lbd/bsdd-meta#> .
      ex:wall ex:customSetLink ex:wallCommon .
      ex:wallCommon a bsddm:PropertySet .`);
    const quad = model.quads.find((candidate) => candidate.predicate.value.endsWith('customSetLink'))!;

    expect(quadLinkCategory(quad, model.resources)).toBe('properties');
    expect(graphEdges(model, new Set([quad.subject.value, quad.object.value]), 'properties')).toEqual([quad]);
  });

  it('reads name-value rows directly from an explicit property-set resource', async () => {
    const model = await parseTurtle(`
      @prefix bsddm: <https://w3id.org/ifc2lbd/bsdd-meta#> .
      @prefix opm: <https://w3id.org/opm#> .
      @prefix schema: <http://schema.org/> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix ex: <https://example.test/> .
      ex:wall bsddm:hasPropertySet ex:set .
      ex:set a bsddm:PropertySet ; rdfs:label "Pset_WallCommon" ; bsddm:containsProperty ex:load .
      ex:load a opm:Property ; rdfs:label "Pset_WallCommon:LoadBearing" ; schema:value true .`);
    const rows = propertyEntriesFor(model.resources.get('https://example.test/set')!, model.resources);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Load Bearing', value: 'true', setName: 'Pset_WallCommon' });
    expect(expansionConnectedIds('https://example.test/set', model.resources, 10, 'properties')).toEqual(
      new Set(['https://example.test/wall']),
    );
  });

  it('shows every explicit property-set node even when an element has more than ten', async () => {
    const sets = Array.from({ length: 13 }, (_, index) => `ex:set_${index}`);
    const declarations = sets.map((set) => `${set} a bsddm:PropertySet .`).join('\n');
    const model = await parseTurtle(`
      @prefix bsddm: <https://w3id.org/ifc2lbd/bsdd-meta#> .
      @prefix ex: <https://example.test/> .
      ex:wall bsddm:hasPropertySet ${sets.join(', ')} .
      ${declarations}`);

    expect(expansionConnectedIds(
      'https://example.test/wall', model.resources, 10, 'properties',
    ).size).toBe(13);
  });
});
