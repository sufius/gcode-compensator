import { Path, Point, sampleArc } from "./geometry";

export type GCodeResult = {
  paths: Path[];
  lineCount: number;
  units: "mm";
};

type Motion = 0 | 1 | 2 | 3;

const WORD = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;

function arcFromRadius(start: Point, end: Point, radiusWord: number, clockwise: boolean): Point | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const radius = Math.abs(radiusWord);
  if (!chord || chord > radius * 2) return null;

  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const distance = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const normal = { x: -dy / chord, y: dx / chord };
  const candidates = [
    { x: midpoint.x + normal.x * distance, y: midpoint.y + normal.y * distance },
    { x: midpoint.x - normal.x * distance, y: midpoint.y - normal.y * distance },
  ];
  const wantsLongArc = radiusWord < 0;

  return candidates.find((center) => {
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    let sweep = endAngle - startAngle;
    if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
    if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
    return (Math.abs(sweep) > Math.PI) === wantsLongArc;
  }) ?? candidates[0];
}

export function parseGCode(source: string): GCodeResult {
  const paths: Path[] = [];
  let position: Point = { x: 0, y: 0 };
  let absolute = true;
  let scale = 1;
  let motion: Motion = 0;
  let parsedLines = 0;

  const sourceLines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const rawLine = sourceLines[lineIndex];
    const line = rawLine.replace(/\([^)]*\)/g, "").replace(/;.*$/, "").trim();
    if (!line) continue;
    const words = new Map<string, number>();
    for (const match of line.matchAll(WORD)) words.set(match[1].toUpperCase(), Number(match[2]));
    if (!words.size) continue;
    parsedLines += 1;

    const gCodes = [...line.matchAll(/G\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)].map((match) => Number(match[1]));
    for (const code of gCodes) {
      if (code === 20) scale = 25.4;
      else if (code === 21) scale = 1;
      else if (code === 90) absolute = true;
      else if (code === 91) absolute = false;
      else if ([0, 1, 2, 3].includes(code)) motion = code as Motion;
    }

    const isArcWithCenter = (motion === 2 || motion === 3) && (words.has("I") || words.has("J"));
    if (!words.has("X") && !words.has("Y") && !isArcWithCenter) continue;
    const target = {
      x: words.has("X") ? (absolute ? words.get("X")! * scale : position.x + words.get("X")! * scale) : position.x,
      y: words.has("Y") ? (absolute ? words.get("Y")! * scale : position.y + words.get("Y")! * scale) : position.y,
    };

    if (motion === 2 || motion === 3) {
      const clockwise = motion === 2;
      let center: Point | null = null;
      if (words.has("I") || words.has("J")) {
        center = { x: position.x + (words.get("I") ?? 0) * scale, y: position.y + (words.get("J") ?? 0) * scale };
      } else if (words.has("R")) {
        center = arcFromRadius(position, target, words.get("R")! * scale, clockwise);
      }
      if (center) {
        const radius = Math.hypot(position.x - center.x, position.y - center.y);
        const points = sampleArc(
          center,
          radius,
          Math.atan2(position.y - center.y, position.x - center.x),
          Math.atan2(target.y - center.y, target.x - center.x),
          clockwise,
        );
        points[0] = position;
        points[points.length - 1] = target;
        paths.push({ points, gcode: { lineIndex, absolute, unitScale: scale } });
      } else paths.push({ points: [position, target], gcode: { lineIndex, absolute, unitScale: scale } });
    } else {
      paths.push({ points: [position, target], rapid: motion === 0, gcode: { lineIndex, absolute, unitScale: scale } });
    }
    position = target;
  }

  return { paths, lineCount: parsedLines, units: "mm" };
}

function pointKey(point: Point) {
  return `${point.x.toFixed(5)}:${point.y.toFixed(5)}`;
}

function formatCoordinate(value: number) {
  const rounded = Math.abs(value) < 5e-7 ? 0 : Number(value.toFixed(5));
  return String(rounded);
}

function replaceCoordinate(line: string, letter: "X" | "Y", value: number) {
  const replacement = `${letter}${formatCoordinate(value)}`;
  const pattern = new RegExp(`${letter}\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)`, "i");
  if (pattern.test(line)) return line.replace(pattern, replacement);
  const commentIndex = line.indexOf(";");
  return commentIndex >= 0
    ? `${line.slice(0, commentIndex).trimEnd()} ${replacement} ${line.slice(commentIndex)}`
    : `${line.trimEnd()} ${replacement}`;
}

export type GCodeEditMode = "translate" | "resize";

export function offsetSelectedGCode(source: string, result: GCodeResult, selectedPathIndices: number[], offset: Point, mode: GCodeEditMode = "translate") {
  if (!selectedPathIndices.length || (!offset.x && !offset.y)) return source;
  const selected = new Set(selectedPathIndices);
  const displacements = new Map<string, Point>();
  const mark = (point: Point) => displacements.set(pointKey(point), offset);

  selected.forEach((index) => {
    const path = result.paths[index];
    if (!path || path.rapid) return;
    if (mode === "translate") mark(path.points[0]);
    mark(path.points[path.points.length - 1]);
  });

  const desiredTargets = result.paths.map((path) => {
    const target = path.points[path.points.length - 1];
    const displacement = displacements.get(pointKey(target));
    return displacement ? { x: target.x + displacement.x, y: target.y + displacement.y } : target;
  });
  const lines = source.split(/\r?\n/);
  let previousTarget = result.paths[0]?.points[0] ?? { x: 0, y: 0 };
  result.paths.forEach((path, index) => {
    if (!path.gcode) return;
    const desired = desiredTargets[index];
    const x = path.gcode.absolute ? desired.x / path.gcode.unitScale : (desired.x - previousTarget.x) / path.gcode.unitScale;
    const y = path.gcode.absolute ? desired.y / path.gcode.unitScale : (desired.y - previousTarget.y) / path.gcode.unitScale;
    lines[path.gcode.lineIndex] = replaceCoordinate(replaceCoordinate(lines[path.gcode.lineIndex], "X", x), "Y", y);
    previousTarget = desired;
  });
  return lines.join("\n");
}
