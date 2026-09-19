import type { Path, Point } from "./geometry";

export type SelectedSegment = { pathIndex: number; segmentIndex: number };

function samePoint(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

export function toggleOverlappingSegment(paths: Path[], selected: SelectedSegment[], clicked: SelectedSegment): SelectedSegment[] {
  const points = paths[clicked.pathIndex]?.points;
  const start = points?.[clicked.segmentIndex];
  const end = points?.[clicked.segmentIndex + 1];
  if (!start || !end) return selected;

  // SVG hit testing always returns the topmost segment. Remove selected copies
  // underneath it before allowing that segment to be selected again.
  const index = selected.findLastIndex((segment) => {
    const candidate = paths[segment.pathIndex]?.points;
    const a = candidate?.[segment.segmentIndex];
    const b = candidate?.[segment.segmentIndex + 1];
    return a && b && ((samePoint(start, a) && samePoint(end, b)) || (samePoint(start, b) && samePoint(end, a)));
  });
  return index >= 0 ? selected.filter((_, selectedIndex) => selectedIndex !== index) : [...selected, clicked];
}
