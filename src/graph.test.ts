import { describe, expect, it } from 'vitest';
import { createObjPreview } from './geometry';
import {
  connectedIds,
  deriveVisible,
  expansionAfterClick,
  expansionConnectedIds,
  parseTurtle,
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
});
