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

  for (const rawLine of source.split(/\r?\n/)) {
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
        paths.push({ points });
      } else paths.push({ points: [position, target] });
    } else {
      paths.push({ points: [position, target], rapid: motion === 0 });
    }
    position = target;
  }

  return { paths, lineCount: parsedLines, units: "mm" };
}
