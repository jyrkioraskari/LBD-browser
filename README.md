# LBD Browser

An interactive browser for Linked Building Data Turtle files produced by [IFCtoLBD](https://github.com/jyrkioraskari/IFCtoLBD), built with [React Flow](https://reactflow.dev/).

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL, then choose **Open Turtle** or drop a `.ttl` file anywhere on the page. Parsing happens locally in the browser.

## Interaction model

- The initial core is the largest `bot:Site` by reachable resources.
- If no site exists, the browser chooses the largest topological BOT building/element root, then falls back to any RDF root.
- Clicking a node focuses it and opens all of its direct incoming and outgoing resource connections; clicking an open node again folds its linked branch transitively.
- If a node has more than 10 direct connections, expansion favors connections using less-common RDF predicates and omits large predicate groups.
- Connected `Pset_` property sets are kept out of the canvas and listed only in the Resource Inspector; building-element connections receive expansion priority.
- The clicked node becomes the new focus; previously expanded branches beyond the selected 1–3 step distance fold away.
- Literal properties are kept out of the graph and shown in the resource inspector.
- Resources with Base64 OBJ geometry linked through `omg:hasGeometry` and `fog:asObj_v3.0-obj` show an isometric geometry preview in their graph node.

## Verification

```bash
npm test
npm run build
```
