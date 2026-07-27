import { Path, Point, sampleArc } from "./geometry";

export type DxfResult = { paths: Path[]; referencePoints: Point[]; entityCount: number };
type Pair = { code: number; value: string };

function number(entity: Pair[], code: number, fallback = 0) {
  const pair = entity.find((item) => item.code === code);
  return pair ? Number(pair.value) : fallback;
}

function sampleBulge(start: Point, end: Point, bulge: number): Point[] {
  if (!bulge) return [start, end];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  const theta = 4 * Math.atan(bulge);
  const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const distance = chord / (2 * Math.tan(theta / 2));
  const center = {
    x: midpoint.x - ((end.y - start.y) / chord) * distance,
    y: midpoint.y + ((end.x - start.x) / chord) * distance,
  };
  return sampleArc(center, radius, Math.atan2(start.y - center.y, start.x - center.x), Math.atan2(end.y - center.y, end.x - center.x), bulge < 0);
}

function lwPolyline(entity: Pair[]): { path: Path; vertices: Point[] } | null {
  const vertices: Array<Point & { bulge: number }> = [];
  for (let index = 0; index < entity.length; index += 1) {
    if (entity[index].code !== 10) continue;
    const x = Number(entity[index].value);
    let y = 0;
    let bulge = 0;
    for (let next = index + 1; next < entity.length && entity[next].code !== 10; next += 1) {
      if (entity[next].code === 20) y = Number(entity[next].value);
      if (entity[next].code === 42) bulge = Number(entity[next].value);
    }
    vertices.push({ x, y, bulge });
  }
  if (vertices.length < 2) return null;
  const closed = (number(entity, 70) & 1) === 1;
  const points: Point[] = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const segment = sampleBulge(current, next, current.bulge);
    points.push(...(index === 0 ? segment : segment.slice(1)));
  }
  return { path: { points, closed }, vertices: vertices.map(({ x, y }) => ({ x, y })) };
}

function uniquePoints(points: Point[]) {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x.toFixed(8)}:${point.y.toFixed(8)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseDxf(source: string): DxfResult {
  const lines = source.replace(/\r/g, "").split("\n");
  if (lines.length < 4) throw new Error("Die Datei enthält keine gültigen DXF-Codepaare.");
  const pairs: Pair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[index + 1].trim() });
  }

  const unitsIndex = pairs.findIndex((pair) => pair.code === 9 && pair.value === "$INSUNITS");
  const unitsCode = unitsIndex >= 0 ? Number(pairs.slice(unitsIndex + 1).find((pair) => pair.code === 70)?.value ?? 0) : 0;
  const unitScale: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  const scale = unitScale[unitsCode] ?? 1;

  const paths: Path[] = [];
  const referencePoints: Point[] = [];
  let entityCount = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index].code !== 0 || !["LINE", "LWPOLYLINE", "CIRCLE", "ARC"].includes(pairs[index].value)) continue;
    const type = pairs[index].value;
    const entity: Pair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index].code !== 0) entity.push(pairs[index++]);
    index -= 1;
    entityCount += 1;

    if (type === "LINE") {
      const points = [{ x: number(entity, 10), y: number(entity, 20) }, { x: number(entity, 11), y: number(entity, 21) }];
      paths.push({ points });
      referencePoints.push(...points.map((point) => ({ ...point })));
    } else if (type === "LWPOLYLINE") {
      const polyline = lwPolyline(entity);
      if (polyline) {
        paths.push(polyline.path);
        referencePoints.push(...polyline.vertices);
      }
    } else {
      const center = { x: number(entity, 10), y: number(entity, 20) };
      const radius = number(entity, 40);
      const start = type === "CIRCLE" ? 0 : (number(entity, 50) * Math.PI) / 180;
      const end = type === "CIRCLE" ? Math.PI * 2 - 1e-10 : (number(entity, 51) * Math.PI) / 180;
      const points = sampleArc(center, radius, start, end);
      paths.push({ points, closed: type === "CIRCLE" });
      if (type === "ARC") referencePoints.push({ ...points[0] }, { ...points[points.length - 1] });
    }
  }
  if (!paths.length) throw new Error("Keine unterstützten DXF-Elemente gefunden (LINE, LWPOLYLINE, ARC, CIRCLE).");
  if (scale !== 1) {
    for (const path of paths) {
      for (const point of path.points) {
        point.x *= scale;
        point.y *= scale;
      }
    }
    for (const point of referencePoints) {
      point.x *= scale;
      point.y *= scale;
    }
  }
  return { paths, referencePoints: uniquePoints(referencePoints), entityCount };
}
