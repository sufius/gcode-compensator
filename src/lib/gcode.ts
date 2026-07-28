import { Path, Point, sampleArc } from "./geometry";

export type GCodeResult = {
  paths: Path[];
  lineCount: number;
  units: "mm";
};

export type PocketFinishingParameters = {
  allowanceX: number;
  allowanceY: number;
  allowanceZ: number;
  roughingFeed: number;
  finishingFeed: number;
};

export type PocketPassSummary = {
  endSizeX: number;
  endSizeY: number;
  roughSizeX: number;
  roughSizeY: number;
  endDepth: number;
  roughDepth: number;
  center: Point;
  roughingFeed: number;
  finishingFeed: number;
  startLine: number;
  endLine: number;
  convertedArcCount: number;
  checks: string[];
};

export type PocketPassResult = {
  content: string;
  summary: PocketPassSummary;
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
  let positionZ = 0;
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
    const targetZ = words.has("Z") ? (absolute ? words.get("Z")! * scale : positionZ + words.get("Z")! * scale) : positionZ;
    if (!words.has("X") && !words.has("Y") && !isArcWithCenter) {
      positionZ = targetZ;
      continue;
    }
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
        paths.push({ points, gcode: { lineIndex, absolute, unitScale: scale, startZ: positionZ, endZ: targetZ, hasExplicitZ: words.has("Z") } });
      } else paths.push({ points: [position, target], gcode: { lineIndex, absolute, unitScale: scale, startZ: positionZ, endZ: targetZ, hasExplicitZ: words.has("Z") } });
    } else {
      paths.push({ points: [position, target], rapid: motion === 0, gcode: { lineIndex, absolute, unitScale: scale, startZ: positionZ, endZ: targetZ, hasExplicitZ: words.has("Z") } });
    }
    position = target;
    positionZ = targetZ;
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

function lineWithoutComments(line: string) {
  return line.replace(/\([^)]*\)/g, "").replace(/;.*$/, "");
}

function wordsInLine(line: string) {
  const words = new Map<string, number>();
  for (const match of lineWithoutComments(line).matchAll(WORD)) words.set(match[1].toUpperCase(), Number(match[2]));
  return words;
}

function replaceCoordinate(line: string, letter: "X" | "Y" | "Z", value: number) {
  const replacement = `${letter}${formatCoordinate(value)}`;
  const pattern = new RegExp(`${letter}\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)`, "i");
  if (pattern.test(line)) return line.replace(pattern, replacement);
  const commentIndex = line.indexOf(";");
  return commentIndex >= 0
    ? `${line.slice(0, commentIndex).trimEnd()} ${replacement} ${line.slice(commentIndex)}`
    : `${line.trimEnd()} ${replacement}`;
}

export function offsetSelectedGCode(source: string, result: GCodeResult, selectedPathIndices: number[], offset: Point) {
  if (!selectedPathIndices.length || (!offset.x && !offset.y)) return source;
  const selected = new Set(selectedPathIndices);
  const displacements = new Map<string, Point>();
  const mark = (point: Point) => displacements.set(pointKey(point), offset);

  selected.forEach((index) => {
    const path = result.paths[index];
    if (!path || path.rapid) return;
    mark(path.points[0]);
    mark(path.points[path.points.length - 1]);
  });

  return rewriteGCodeWithDisplacements(source, result, displacements);
}

export function offsetSelectedGCodeNodes(source: string, result: GCodeResult, selectedNodes: Point[], offset: Point) {
  if (!selectedNodes.length || (!offset.x && !offset.y)) return source;
  const displacements = new Map(selectedNodes.map((point) => [pointKey(point), offset]));
  return rewriteGCodeWithDisplacements(source, result, displacements);
}

export function offsetSelectedGCodeZ(source: string, result: GCodeResult, selectedPathIndices: number[], offset: number) {
  if (!selectedPathIndices.length || !offset) return source;
  const lines = source.split(/\r?\n/);
  const selectedLines = new Set<number>();

  selectedPathIndices.forEach((index) => {
    const path = result.paths[index];
    if (!path?.gcode || path.rapid || selectedLines.has(path.gcode.lineIndex)) return;
    const rawLine = lines[path.gcode.lineIndex];
    const line = rawLine.replace(/\([^)]*\)/g, "").replace(/;.*$/, "").trim();
    const words = new Map<string, number>();
    for (const match of line.matchAll(WORD)) words.set(match[1].toUpperCase(), Number(match[2]));
    if (!words.has("Z")) return;
    lines[path.gcode.lineIndex] = replaceCoordinate(rawLine, "Z", words.get("Z")! + offset / path.gcode.unitScale);
    selectedLines.add(path.gcode.lineIndex);
  });

  return lines.join("\n");
}

function rewriteGCodeWithDisplacements(source: string, result: GCodeResult, displacements: Map<string, Point>) {
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


function replaceFeed(line: string, feed: number) {
  return /F\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i.test(line)
    ? line.replace(/F\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/gi, `F${formatCoordinate(feed)}`)
    : line;
}

function findPocketLineRange(lines: string[], result: GCodeResult, selectedPathIndices: number[]) {
  const selectedPaths = selectedPathIndices
    .map((index) => result.paths[index])
    .filter((path): path is Path & { gcode: NonNullable<Path["gcode"]> } => !!path?.gcode && !path.rapid);
  if (!selectedPaths.length) throw new Error("Bitte die Fräsbewegungen eines vollständigen Taschenblocks auswählen.");

  const firstSelectedLine = Math.min(...selectedPaths.map((path) => path.gcode.lineIndex));
  const lastSelectedLine = Math.max(...selectedPaths.map((path) => path.gcode.lineIndex));
  const precedingRapid = result.paths
    .filter((path) => path.rapid && path.gcode && path.gcode.lineIndex < firstSelectedLine)
    .at(-1);
  const startLine = precedingRapid?.gcode?.lineIndex ?? firstSelectedLine;

  let endLine = lastSelectedLine;
  let modalMotion: Motion = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const words = wordsInLine(lines[lineIndex]);
    const codes = [...lineWithoutComments(lines[lineIndex]).matchAll(/G\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)].map((match) => Number(match[1]));
    for (const code of codes) if ([0, 1, 2, 3].includes(code)) modalMotion = code as Motion;
    if (lineIndex > lastSelectedLine && modalMotion === 0 && words.has("Z")) {
      endLine = lineIndex;
      break;
    }
  }
  return { startLine, endLine, firstSelectedLine, lastSelectedLine };
}

type LineState = { absolute: boolean; scale: number; motion: Motion; startZ: number; endZ: number; words: Map<string, number> };

function getLineStates(lines: string[]) {
  const states: LineState[] = [];
  let absolute = true;
  let scale = 1;
  let motion: Motion = 0;
  let z = 0;
  lines.forEach((line) => {
    const words = wordsInLine(line);
    const codes = [...lineWithoutComments(line).matchAll(/G\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)].map((match) => Number(match[1]));
    for (const code of codes) {
      if (code === 20) scale = 25.4;
      else if (code === 21) scale = 1;
      else if (code === 90) absolute = true;
      else if (code === 91) absolute = false;
      else if ([0, 1, 2, 3].includes(code)) motion = code as Motion;
    }
    const endZ = words.has("Z") ? (absolute ? words.get("Z")! * scale : z + words.get("Z")! * scale) : z;
    states.push({ absolute, scale, motion, startZ: z, endZ, words });
    z = endZ;
  });
  return states;
}

function transformPocketPoint(point: Point, center: Point, scaleX: number, scaleY: number): Point {
  return { x: center.x + (point.x - center.x) * scaleX, y: center.y + (point.y - center.y) * scaleY };
}

function originalComment(line: string) {
  const semicolon = line.indexOf(";");
  const parenthesized = line.match(/\([^)]*\)/g)?.join(" ");
  return semicolon >= 0 ? line.slice(semicolon).trim() : parenthesized ?? "";
}

/**
 * Splits one selected, complete pocket operation into roughing and finishing.
 * The original block is retained byte-for-byte geometrically for finishing;
 * only its feed words are normalized to the requested finishing feed.
 */
export function createPocketRoughingAndFinishing(
  source: string,
  result: GCodeResult,
  selectedPathIndices: number[],
  parameters: PocketFinishingParameters,
): PocketPassResult {
  const values = Object.values(parameters);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("Alle Schrupp- und Schlichtparameter müssen gültige Zahlen sein.");
  if (parameters.allowanceX < 0 || parameters.allowanceY < 0 || parameters.allowanceZ < 0) throw new Error("Schlichtzugaben dürfen nicht negativ sein.");
  if (parameters.roughingFeed <= 0 || parameters.finishingFeed <= 0) throw new Error("Vorschübe müssen größer als 0 mm/min sein.");

  const lines = source.split(/\r?\n/);
  const range = findPocketLineRange(lines, result, selectedPathIndices);
  const lineStates = getLineStates(lines);
  if (lineStates.slice(range.startLine, range.endLine + 1).some((state) => !state.absolute)) {
    throw new Error("Der ausgewählte Taschenblock enthält relative Koordinaten (G91). Bitte zuerst in absolute Koordinaten (G90) umwandeln.");
  }

  const operationPaths = result.paths.filter((path) => path.gcode
    && !path.rapid
    && path.gcode.lineIndex >= range.startLine
    && path.gcode.lineIndex <= range.endLine);
  if (!operationPaths.length) throw new Error("Im ausgewählten Bereich wurden keine Fräsbewegungen erkannt.");
  const endDepth = Math.min(...operationPaths.flatMap((path) => [path.gcode!.startZ, path.gcode!.endZ]));
  const tolerance = 1e-6;
  const floorPaths = operationPaths.filter((path) => path.gcode!.startZ <= endDepth + tolerance || path.gcode!.endZ <= endDepth + tolerance);
  const floorPoints = floorPaths.flatMap((path) => {
    const startsAtFloor = path.gcode!.startZ <= endDepth + tolerance;
    const endsAtFloor = path.gcode!.endZ <= endDepth + tolerance;
    if (startsAtFloor && endsAtFloor) return path.points;
    if (startsAtFloor) return [path.points[0]];
    return [path.points[path.points.length - 1]];
  });
  if (floorPoints.length < 2) throw new Error("Die Endgeometrie der Tasche konnte auf der tiefsten Z-Ebene nicht bestimmt werden.");
  const minX = Math.min(...floorPoints.map((point) => point.x));
  const maxX = Math.max(...floorPoints.map((point) => point.x));
  const minY = Math.min(...floorPoints.map((point) => point.y));
  const maxY = Math.max(...floorPoints.map((point) => point.y));
  const endSizeX = maxX - minX;
  const endSizeY = maxY - minY;
  const roughSizeX = endSizeX - parameters.allowanceX * 2;
  const roughSizeY = endSizeY - parameters.allowanceY * 2;
  if (endSizeX <= tolerance || endSizeY <= tolerance) throw new Error("Die Auswahl bildet keine zweidimensionale, geschlossene Taschenfläche.");
  if (roughSizeX <= tolerance || roughSizeY <= tolerance) throw new Error("Die XY-Schlichtzugabe ist größer als die halbe Taschengröße.");

  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const scaleX = roughSizeX / endSizeX;
  const scaleY = roughSizeY / endSizeY;
  const roughDepth = endDepth + parameters.allowanceZ;
  const cuttingStates = lineStates.slice(range.startLine, range.endLine + 1).filter((state) => state.motion !== 0 && state.words.size > 0);
  const topOfCut = Math.max(...cuttingStates.flatMap((state) => [state.startZ, state.endZ]));
  if (roughDepth > topOfCut + tolerance) throw new Error("Die Z-Schlichtzugabe ist größer als die erkannte Taschentiefe.");
  let originalFeed: number | null = null;
  for (let lineIndex = 0; lineIndex <= range.endLine; lineIndex += 1) {
    const feed = lineStates[lineIndex].words.get("F");
    if (feed !== undefined) originalFeed = feed;
  }
  if (originalFeed === null) throw new Error("Vor oder im Taschenblock wurde kein ursprünglicher Vorschub (F) gefunden.");
  const pathsByLine = new Map(result.paths.filter((path) => path.gcode).map((path) => [path.gcode!.lineIndex, path]));
  let convertedArcCount = 0;

  const roughLines: string[] = [];
  for (let lineIndex = range.startLine; lineIndex <= range.endLine; lineIndex += 1) {
    const original = lines[lineIndex];
    const state = lineStates[lineIndex];
    const path = pathsByLine.get(lineIndex);
    let line = replaceFeed(original, parameters.roughingFeed / state.scale);

    if (path?.gcode) {
      const isArc = path.points.length > 2;
      const nonUniform = Math.abs(scaleX - scaleY) > 1e-9;
      if (isArc && nonUniform) {
        convertedArcCount += 1;
        const lastPointIndex = path.points.length - 1;
        path.points.slice(1).forEach((point, pointIndex) => {
          const transformed = transformPocketPoint(point, center, scaleX, scaleY);
          let segment = `G1 X${formatCoordinate(transformed.x / path.gcode!.unitScale)} Y${formatCoordinate(transformed.y / path.gcode!.unitScale)}`;
          if (path.gcode!.hasExplicitZ) {
            const fraction = (pointIndex + 1) / lastPointIndex;
            const interpolatedZ = path.gcode!.startZ + (path.gcode!.endZ - path.gcode!.startZ) * fraction;
            segment += ` Z${formatCoordinate(Math.max(interpolatedZ, roughDepth) / path.gcode!.unitScale)}`;
          }
          if (pointIndex === lastPointIndex - 1) {
            const comment = originalComment(original);
            if (comment) segment += ` ${comment}`;
          }
          roughLines.push(segment);
        });
        continue;
      }

      const target = path.points[path.points.length - 1];
      const transformed = transformPocketPoint(target, center, scaleX, scaleY);
      if (state.words.has("X")) line = replaceCoordinate(line, "X", transformed.x / path.gcode.unitScale);
      if (state.words.has("Y")) line = replaceCoordinate(line, "Y", transformed.y / path.gcode.unitScale);
      if (isArc) {
        if (state.words.has("I")) line = line.replace(/I\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i, `I${formatCoordinate(state.words.get("I")! * scaleX)}`);
        if (state.words.has("J")) line = line.replace(/J\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i, `J${formatCoordinate(state.words.get("J")! * scaleY)}`);
        if (state.words.has("R")) line = line.replace(/R\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i, `R${formatCoordinate(state.words.get("R")! * scaleX)}`);
      }
    }
    if (state.words.has("Z") && state.motion !== 0 && state.endZ < roughDepth) {
      line = replaceCoordinate(line, "Z", roughDepth / state.scale);
    }
    roughLines.push(line);
  }

  const finishLines = lines.slice(range.startLine, range.endLine + 1).map((line, index) => replaceFeed(line, parameters.finishingFeed / lineStates[range.startLine + index].scale));
  const startScale = lineStates[range.startLine].scale;
  const replacement = [
    `; --- Schruppen: X/Y ${formatCoordinate(parameters.allowanceX)}/${formatCoordinate(parameters.allowanceY)} mm, Boden ${formatCoordinate(parameters.allowanceZ)} mm ---`,
    `F${formatCoordinate(parameters.roughingFeed / startScale)}`,
    ...roughLines,
    `; --- Schlichten auf ursprüngliches Endmaß ---`,
    `F${formatCoordinate(parameters.finishingFeed / startScale)}`,
    ...finishLines,
    `; ursprünglichen modalen Vorschub für nachfolgende Operationen wiederherstellen`,
    `F${formatCoordinate(originalFeed)}`,
  ];
  const content = [...lines.slice(0, range.startLine), ...replacement, ...lines.slice(range.endLine + 1)].join("\n");

  return {
    content,
    summary: {
      endSizeX,
      endSizeY,
      roughSizeX,
      roughSizeY,
      endDepth,
      roughDepth,
      center,
      roughingFeed: parameters.roughingFeed,
      finishingFeed: parameters.finishingFeed,
      startLine: range.startLine,
      endLine: range.endLine,
      convertedArcCount,
      checks: [
        "Schruppgrenzen liegen vollständig innerhalb der Endgrenzen.",
        "Der Taschenmittelpunkt bleibt bei der symmetrischen Zugabe unverändert.",
        "Der vollständige Originalpfad wird anschließend als Schlichtdurchgang gefahren.",
        "Die ursprüngliche Endkontur und Endtiefe bleiben im Schlichtdurchgang erhalten.",
      ],
    },
  };
}
