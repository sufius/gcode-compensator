export type Point = { x: number; y: number };

export type Path = {
  points: Point[];
  closed?: boolean;
  rapid?: boolean;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function getBounds(paths: Path[]): Bounds | null {
  const points = paths.flatMap((path) => path.points);
  if (!points.length) return null;

  return points.reduce<Bounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function combineBounds(...bounds: Array<Bounds | null>): Bounds {
  const valid = bounds.filter((item): item is Bounds => item !== null);
  if (!valid.length) return { minX: -10, minY: -10, maxX: 100, maxY: 100 };

  return valid.reduce<Bounds>(
    (result, item) => ({
      minX: Math.min(result.minX, item.minX),
      minY: Math.min(result.minY, item.minY),
      maxX: Math.max(result.maxX, item.maxX),
      maxY: Math.max(result.maxY, item.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function sampleArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  clockwise = false,
): Point[] {
  let sweep = endAngle - startAngle;
  if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
  if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
  const segments = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / segments;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}
