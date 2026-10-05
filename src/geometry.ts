export interface GeometryPreviewData {
  path: string;
}

interface Point2D {
  x: number;
  y: number;
}

const PREVIEW_WIDTH = 52;
const PREVIEW_HEIGHT = 44;
const PREVIEW_PADDING = 4;
const MAX_PREVIEW_EDGES = 240;

function decodeBase64(value: string): string | null {
  try {
    return atob(value.trim());
  } catch {
    return null;
  }
}

function objIndex(value: string, vertexCount: number): number | null {
  const parsed = Number.parseInt(value.split('/')[0], 10);
  if (!Number.isInteger(parsed) || parsed === 0) return null;
  const index = parsed > 0 ? parsed - 1 : vertexCount + parsed;
  return index >= 0 && index < vertexCount ? index : null;
}

export function createObjPreview(encodedObj: string): GeometryPreviewData | null {
  const obj = decodeBase64(encodedObj);
  if (!obj) return null;

  const vertices: Array<[number, number, number]> = [];
  const faces: string[][] = [];
  for (const line of obj.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const coordinates = parts.slice(1, 4).map(Number);
      if (coordinates.every(Number.isFinite)) {
        vertices.push(coordinates as [number, number, number]);
      }
    } else if ((parts[0] === 'f' || parts[0] === 'l') && parts.length >= 3) {
      faces.push(parts.slice(1));
    }
  }
  if (vertices.length < 2) return null;

  // Match LBDViewer's Z-up, elevated camera with a compact isometric projection.
  const projected: Point2D[] = vertices.map(([x, y, z]) => ({
    x: x - y * 0.38,
    y: z + y * 0.58,
  }));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of projected) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const scale = Math.min(
    (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / Math.max(maxX - minX, 0.001),
    (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / Math.max(maxY - minY, 0.001),
  );
  const offsetX = (PREVIEW_WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (PREVIEW_HEIGHT - (maxY - minY) * scale) / 2;
  const fitted = projected.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: PREVIEW_HEIGHT - offsetY - (point.y - minY) * scale,
  }));

  const edgeKeys = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const face of faces) {
    const indices = face
      .map((value) => objIndex(value, vertices.length))
      .filter((index): index is number => index !== null);
    const edgeCount = face.length > 2 && indices.length > 2 ? indices.length : indices.length - 1;
    for (let index = 0; index < edgeCount; index += 1) {
      const start = indices[index];
      const end = indices[(index + 1) % indices.length];
      if (start === end) continue;
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([start, end]);
      }
    }
  }
  if (!edges.length) return null;

  const stride = Math.max(1, Math.ceil(edges.length / MAX_PREVIEW_EDGES));
  const path = edges
    .filter((_, index) => index % stride === 0)
    .map(([start, end]) => {
      const from = fitted[start];
      const to = fitted[end];
      return `M${from.x.toFixed(2)} ${from.y.toFixed(2)}L${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
    })
    .join('');

  return path ? { path } : null;
}
