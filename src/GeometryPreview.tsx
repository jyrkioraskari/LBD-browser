import { useMemo, type ReactNode } from 'react';
import { createObjPreview } from './geometry';

interface GeometryPreviewProps {
  encodedObj: string;
  fallback: ReactNode;
}

export default function GeometryPreview({ encodedObj, fallback }: GeometryPreviewProps) {
  const preview = useMemo(() => createObjPreview(encodedObj), [encodedObj]);
  if (!preview) return fallback;

  return (
    <span className="node-geometry" title="Embedded OBJ geometry">
      <svg viewBox="0 0 52 44" role="img" aria-label="Building element geometry preview">
        <path d={preview.path} />
      </svg>
    </span>
  );
}
