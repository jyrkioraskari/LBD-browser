export const SAMPLE_TURTLE = `@prefix bot: <https://w3id.org/bot#> .
@prefix inst: <https://example.org/duplex/> .
@prefix props: <https://w3id.org/props#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

inst:site_1 a bot:Site ;
  rdfs:label "Duplex site" ;
  bot:hasBuilding inst:building_1 .

inst:building_1 a bot:Building ;
  props:nameIfcRoot_attribute_simple "Duplex apartment" ;
  bot:hasStorey inst:storey_ground, inst:storey_first .

inst:storey_ground a bot:Storey ;
  rdfs:label "Ground floor" ;
  bot:hasSpace inst:space_living, inst:space_kitchen ;
  bot:containsElement inst:wall_ext_01, inst:slab_ground .

inst:storey_first a bot:Storey ;
  rdfs:label "First floor" ;
  bot:hasSpace inst:space_bedroom, inst:space_bathroom ;
  bot:containsElement inst:slab_first .

inst:space_living a bot:Space ;
  rdfs:label "Living room" ;
  bot:adjacentElement inst:wall_ext_01, inst:door_01, inst:window_01 .

inst:space_kitchen a bot:Space ;
  rdfs:label "Kitchen" ;
  bot:adjacentElement inst:door_01, inst:wall_int_01 .

inst:space_bedroom a bot:Space ; rdfs:label "Bedroom" ; bot:adjacentElement inst:window_02, inst:wall_int_01 .
inst:space_bathroom a bot:Space ; rdfs:label "Bathroom" ; bot:adjacentElement inst:wall_int_01 .

inst:wall_ext_01 a bot:Element ; rdfs:label "External wall 01" ; props:globalIdIfcRoot_attribute_simple "2O2Fr$t4X7Zf8NOew3FLOH" .
inst:wall_int_01 a bot:Element ; rdfs:label "Partition wall 01" .
inst:door_01 a bot:Element ; rdfs:label "Interior door 01" .
inst:window_01 a bot:Element ; rdfs:label "Living room window" .
inst:window_02 a bot:Element ; rdfs:label "Bedroom window" .
inst:slab_ground a bot:Element ; rdfs:label "Ground slab" .
inst:slab_first a bot:Element ; rdfs:label "First-floor slab" .
`;
