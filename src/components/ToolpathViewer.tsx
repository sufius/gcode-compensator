"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddRounded from "@mui/icons-material/AddRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { Bounds, combineBounds, getBounds, Path, Point } from "@/lib/geometry";

const WIDTH = 1000;
const HEIGHT = 620;
const PADDING = 62;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

type Viewport = { zoom: number; panX: number; panY: number };
type ScreenBox = { minX: number; minY: number; maxX: number; maxY: number };
type SelectedSegment = { pathIndex: number; segmentIndex: number };

function niceStep(range: number) {
  const rough = Math.max(range, 1e-6) / 8;
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const factor = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return factor * power;
}

function ticks(min: number, max: number, step: number) {
  const values: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-8; value += step) values.push(Number(value.toPrecision(12)));
  return values;
}

function formatTick(value: number) {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 4 });
}

function pathData(path: Path, project: (x: number, y: number) => [number, number]) {
  const commands = path.points.map((point, index) => {
    const [x, y] = project(point.x, point.y);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  if (path.closed) commands.push("Z");
  return commands.join(" ");
}

function normalizedBox(start: Point, end: Point): ScreenBox {
  return { minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y), maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y) };
}

function pointInBox(point: Point, box: ScreenBox) {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function linesIntersect(a: Point, b: Point, c: Point, d: Point) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x)
    || Math.max(c.x, d.x) < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) < Math.min(c.y, d.y)
    || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function segmentIntersectsBox(start: Point, end: Point, box: ScreenBox) {
  if (pointInBox(start, box) || pointInBox(end, box)) return true;
  const topLeft = { x: box.minX, y: box.minY };
  const topRight = { x: box.maxX, y: box.minY };
  const bottomRight = { x: box.maxX, y: box.maxY };
  const bottomLeft = { x: box.minX, y: box.maxY };
  return linesIntersect(start, end, topLeft, topRight)
    || linesIntersect(start, end, topRight, bottomRight)
    || linesIntersect(start, end, bottomRight, bottomLeft)
    || linesIntersect(start, end, bottomLeft, topLeft);
}

function mergeSelectedSegments(current: SelectedSegment[], additions: SelectedSegment[]) {
  const segments = new Map(current.map((segment) => [`${segment.pathIndex}:${segment.segmentIndex}`, segment]));
  additions.forEach((segment) => segments.set(`${segment.pathIndex}:${segment.segmentIndex}`, segment));
  return [...segments.values()];
}

function nodeKey(point: Point) {
  return `${point.x.toFixed(5)}:${point.y.toFixed(5)}`;
}

function paddedBounds(bounds: Bounds): Bounds {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return {
    minX: bounds.minX - width * 0.07,
    maxX: bounds.maxX + width * 0.07,
    minY: bounds.minY - height * 0.07,
    maxY: bounds.maxY + height * 0.07,
  };
}

type ViewerProps = {
  dxfPaths: Path[];
  gcodePaths: Path[];
  referencePoints?: Point[];
  selectingOrigin?: boolean;
  onSelectOrigin?: (index: number) => void;
  onSelectionChange?: (pathIndices: number[]) => void;
  nodeMode?: boolean;
  onNodeSelectionChange?: (points: Point[]) => void;
  fill?: boolean;
};

export function ToolpathViewer({ dxfPaths, gcodePaths, referencePoints = [], selectingOrigin = false, onSelectOrigin, onSelectionChange, nodeMode = false, onNodeSelectionChange, fill = false }: ViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Point | null>(null);
  const selectionStartRef = useRef<Point | null>(null);
  const selectionCurrentRef = useRef<Point | null>(null);
  const additiveSelectionRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [drawingSelection, setDrawingSelection] = useState(false);
  const [selectionBox, setSelectionBox] = useState<ScreenBox | null>(null);
  const [selection, setSelection] = useState<{ paths: Path[]; segments: SelectedSegment[] } | null>(null);
  const [nodeSelection, setNodeSelection] = useState<{ paths: Path[]; keys: string[] } | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<{ paths: Path[]; segment: SelectedSegment } | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, panX: 0, panY: 0 });

  const scene = useMemo(() => {
    const bounds = paddedBounds(combineBounds(getBounds(dxfPaths), getBounds(gcodePaths)));
    const dataWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const dataHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min((WIDTH - PADDING * 2) / dataWidth, (HEIGHT - PADDING * 2) / dataHeight);
    const drawingWidth = dataWidth * scale;
    const drawingHeight = dataHeight * scale;
    const offsetX = (WIDTH - drawingWidth) / 2;
    const offsetY = (HEIGHT - drawingHeight) / 2;
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    const project = (x: number, y: number): [number, number] => {
      const baseX = offsetX + (x - bounds.minX) * scale;
      const baseY = HEIGHT - offsetY - (y - bounds.minY) * scale;
      return [centerX + (baseX - centerX) * viewport.zoom + viewport.panX, centerY + (baseY - centerY) * viewport.zoom + viewport.panY];
    };
    const unproject = (screenX: number, screenY: number): Point => {
      const baseX = centerX + (screenX - centerX - viewport.panX) / viewport.zoom;
      const baseY = centerY + (screenY - centerY - viewport.panY) / viewport.zoom;
      return { x: bounds.minX + (baseX - offsetX) / scale, y: bounds.minY + (HEIGHT - offsetY - baseY) / scale };
    };
    const topLeft = unproject(0, 0);
    const bottomRight = unproject(WIDTH, HEIGHT);
    const visible = {
      minX: Math.min(topLeft.x, bottomRight.x),
      maxX: Math.max(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxY: Math.max(topLeft.y, bottomRight.y),
    };
    const step = niceStep(Math.max(visible.maxX - visible.minX, visible.maxY - visible.minY));
    return { project, xTicks: ticks(visible.minX, visible.maxX, step), yTicks: ticks(visible.minY, visible.maxY, step), step };
  }, [dxfPaths, gcodePaths, viewport]);

  const gcodeNodes = useMemo(() => {
    const nodes = new Map<string, Point>();
    gcodePaths.forEach((path) => {
      if (path.rapid || path.points.length < 2) return;
      const endpoints = [path.points[0], path.points[path.points.length - 1]];
      endpoints.forEach((point) => nodes.set(nodeKey(point), point));
    });
    return [...nodes.entries()].map(([key, point]) => ({ key, point }));
  }, [gcodePaths]);

  const svgPoint = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: WIDTH / 2, y: HEIGHT / 2 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const zoomAt = useCallback((point: Point, factor: number) => {
    setViewport((current) => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return {
        zoom,
        panX: point.x - WIDTH / 2 - (point.x - WIDTH / 2 - current.panX) * ratio,
        panY: point.y - HEIGHT / 2 - (point.y - HEIGHT / 2 - current.panY) * ratio,
      };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        const factor = Math.exp(-event.deltaY * 0.0025);
        zoomAt(svgPoint(event.clientX, event.clientY), factor);
        return;
      }

      const bounds = svg.getBoundingClientRect();
      const modeFactor = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? bounds.height
          : 1;
      const deltaX = event.deltaX * modeFactor;
      const deltaY = event.deltaY * modeFactor;
      const horizontalDelta = event.shiftKey ? (deltaY || deltaX) : deltaX;
      setViewport((current) => ({
        ...current,
        panX: current.panX - horizontalDelta * WIDTH / Math.max(bounds.width, 1),
        panY: current.panY - (event.shiftKey ? 0 : deltaY) * HEIGHT / Math.max(bounds.height, 1),
      }));
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [svgPoint, zoomAt]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const previous = dragRef.current;
      if (!previous || (event.buttons & 2) === 0) {
        dragRef.current = null;
        setDragging(false);
        return;
      }
      event.preventDefault();
      const previousSvg = svgPoint(previous.x, previous.y);
      const currentSvg = svgPoint(event.clientX, event.clientY);
      setViewport((current) => ({
        ...current,
        panX: current.panX + currentSvg.x - previousSvg.x,
        panY: current.panY + currentSvg.y - previousSvg.y,
      }));
      dragRef.current = { x: event.clientX, y: event.clientY };
    };
    const finish = () => {
      dragRef.current = null;
      setDragging(false);
    };
    const preventMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    window.addEventListener("contextmenu", preventMenu);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      window.removeEventListener("contextmenu", preventMenu);
    };
  }, [dragging, svgPoint]);

  useEffect(() => {
    if (!drawingSelection) return;

    const handleMouseMove = (event: MouseEvent) => {
      const start = selectionStartRef.current;
      if (!start || (event.buttons & 1) === 0) return;
      event.preventDefault();
      const current = svgPoint(event.clientX, event.clientY);
      selectionCurrentRef.current = current;
      setSelectionBox(normalizedBox(start, current));
    };
    const finish = () => {
      const start = selectionStartRef.current;
      const current = selectionCurrentRef.current;
      const additive = additiveSelectionRef.current;
      if (start && current) {
        const box = normalizedBox(start, current);
        if (box.maxX - box.minX >= 3 && box.maxY - box.minY >= 3) {
          if (nodeMode) {
            const keys = gcodeNodes.filter(({ point }) => {
              const [x, y] = scene.project(point.x, point.y);
              return pointInBox({ x, y }, box);
            }).map((node) => node.key);
            setNodeSelection((currentSelection) => ({
              paths: gcodePaths,
              keys: additive && currentSelection?.paths === gcodePaths
                ? [...new Set([...currentSelection.keys, ...keys])]
                : keys,
            }));
          } else {
          const segments: SelectedSegment[] = [];
          gcodePaths.forEach((path, pathIndex) => {
            if (path.rapid) return;
            for (let segmentIndex = 0; segmentIndex + 1 < path.points.length; segmentIndex += 1) {
              const [startX, startY] = scene.project(path.points[segmentIndex].x, path.points[segmentIndex].y);
              const [endX, endY] = scene.project(path.points[segmentIndex + 1].x, path.points[segmentIndex + 1].y);
              if (segmentIntersectsBox({ x: startX, y: startY }, { x: endX, y: endY }, box)) segments.push({ pathIndex, segmentIndex });
            }
          });
          setSelection((currentSelection) => ({
            paths: gcodePaths,
            segments: additive && currentSelection?.paths === gcodePaths
              ? mergeSelectedSegments(currentSelection.segments, segments)
              : segments,
          }));
          }
        } else {
          if (nodeMode) {
            setNodeSelection((currentSelection) => additive && currentSelection?.paths === gcodePaths ? currentSelection : { paths: gcodePaths, keys: [] });
          } else {
            setSelection((currentSelection) => additive && currentSelection?.paths === gcodePaths ? currentSelection : { paths: gcodePaths, segments: [] });
          }
        }
      }
      selectionStartRef.current = null;
      selectionCurrentRef.current = null;
      additiveSelectionRef.current = false;
      setSelectionBox(null);
      setDrawingSelection(false);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
    };
  }, [drawingSelection, gcodeNodes, gcodePaths, nodeMode, scene, svgPoint]);

  const selectedSegments = selection?.paths === gcodePaths ? selection.segments : [];
  const activeHoveredSegment = hoveredSegment?.paths === gcodePaths ? hoveredSegment.segment : null;
  const selectedNodeKeys = nodeSelection?.paths === gcodePaths ? nodeSelection.keys : [];
  const selectedPathSignature = [...new Set(selectedSegments.map((segment) => segment.pathIndex))].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const pathIndices = selectedPathSignature ? selectedPathSignature.split(",").map(Number) : [];
    const timer = window.setTimeout(() => onSelectionChange?.(pathIndices), 0);
    return () => window.clearTimeout(timer);
  }, [onSelectionChange, selectedPathSignature]);

  const selectedNodeSignature = [...selectedNodeKeys].sort().join("|");
  useEffect(() => {
    const selected = new Set(selectedNodeSignature ? selectedNodeSignature.split("|") : []);
    const points = gcodeNodes.filter((node) => selected.has(node.key)).map((node) => node.point);
    const timer = window.setTimeout(() => onNodeSelectionChange?.(points), 0);
    return () => window.clearTimeout(timer);
  }, [gcodeNodes, onNodeSelectionChange, selectedNodeSignature]);

  function toggleSegmentSelection(segment: SelectedSegment) {
    setSelection((currentSelection) => ({
      paths: gcodePaths,
      segments: currentSelection?.paths === gcodePaths
        ? currentSelection.segments.some((current) => current.pathIndex === segment.pathIndex && current.segmentIndex === segment.segmentIndex)
          ? currentSelection.segments.filter((current) => current.pathIndex !== segment.pathIndex || current.segmentIndex !== segment.segmentIndex)
          : mergeSelectedSegments(currentSelection.segments, [segment])
        : [segment],
    }));
  }

  function toggleNodeSelection(key: string, additive: boolean) {
    setNodeSelection((currentSelection) => {
      const current = currentSelection?.paths === gcodePaths ? currentSelection.keys : [];
      const keys = current.includes(key) ? current.filter((item) => item !== key) : additive ? [...current, key] : [key];
      return { paths: gcodePaths, keys };
    });
  }

  const isEmpty = !dxfPaths.length && !gcodePaths.length;

  return (
    <Box sx={{ position: "relative", width: "100%", height: fill ? "100%" : undefined, minHeight: fill ? 0 : 440, aspectRatio: fill ? undefined : `${WIDTH}/${HEIGHT}`, bgcolor: "#0a0e13", borderRadius: 2, overflow: "hidden", border: "1px solid", borderColor: "divider" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="Interaktives Koordinatensystem mit DXF-Konturen und G-Code-Werkzeugwegen"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button === 0 && !selectingOrigin) {
            event.preventDefault();
            const start = svgPoint(event.clientX, event.clientY);
            selectionStartRef.current = start;
            selectionCurrentRef.current = start;
            additiveSelectionRef.current = event.ctrlKey || event.shiftKey;
            setSelectionBox(normalizedBox(start, start));
            setDrawingSelection(true);
          } else if (event.button === 2) {
            event.preventDefault();
            dragRef.current = { x: event.clientX, y: event.clientY };
            setDragging(true);
          }
        }}
        style={{ cursor: dragging ? "grabbing" : drawingSelection ? "crosshair" : "default", touchAction: "none", userSelect: "none" }}
      >
        <rect width={WIDTH} height={HEIGHT} fill="#0a0e13" />
        {scene.xTicks.map((value) => {
          const [x] = scene.project(value, 0);
          return <g key={`x-${value}`}><line x1={x} y1={0} x2={x} y2={HEIGHT} stroke={value === 0 ? "#667080" : "#252d38"} strokeWidth={value === 0 ? 1.5 : 1} /><text x={x} y={HEIGHT - 18} fill="#7f8a99" fontSize="13" textAnchor="middle">{formatTick(value)}</text></g>;
        })}
        {scene.yTicks.map((value) => {
          const [, y] = scene.project(0, value);
          return <g key={`y-${value}`}><line x1={0} y1={y} x2={WIDTH} y2={y} stroke={value === 0 ? "#667080" : "#252d38"} strokeWidth={value === 0 ? 1.5 : 1} /><text x={18} y={y + 4} fill="#7f8a99" fontSize="13">{formatTick(value)}</text></g>;
        })}
        {dxfPaths.map((path, index) => <path key={`dxf-${index}`} d={pathData(path, scene.project)} fill="none" stroke="#55d6be" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
        {gcodePaths.map((path, index) => <path key={`gcode-${index}`} d={pathData(path, scene.project)} fill="none" stroke={path.rapid ? "#8a96a8" : "#ffb454"} strokeOpacity={path.rapid ? 0.5 : 0.95} strokeDasharray={path.rapid ? "7 6" : undefined} strokeWidth={path.rapid ? 1.2 : 2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
        {!nodeMode ? selectedSegments.map(({ pathIndex, segmentIndex }) => {
          const path = gcodePaths[pathIndex];
          if (!path?.points[segmentIndex + 1]) return null;
          const d = pathData({ points: [path.points[segmentIndex], path.points[segmentIndex + 1]] }, scene.project);
          return <path key={`selected-${pathIndex}-${segmentIndex}`} d={d} fill="none" stroke="#ff4fd8" strokeWidth={5} vectorEffect="non-scaling-stroke" strokeLinecap="round" />;
        }) : null}
        {!nodeMode && activeHoveredSegment ? (() => {
          const path = gcodePaths[activeHoveredSegment.pathIndex];
          if (!path?.points[activeHoveredSegment.segmentIndex + 1]) return null;
          const d = pathData({ points: [path.points[activeHoveredSegment.segmentIndex], path.points[activeHoveredSegment.segmentIndex + 1]] }, scene.project);
          return <path d={d} fill="none" stroke="#fff3c4" strokeWidth={7} strokeOpacity={0.9} vectorEffect="non-scaling-stroke" strokeLinecap="round" pointerEvents="none" />;
        })() : null}
        {!nodeMode ? gcodePaths.map((path, pathIndex) => path.rapid ? null : path.points.slice(0, -1).map((point, segmentIndex) => {
          const segment = { pathIndex, segmentIndex };
          const d = pathData({ points: [point, path.points[segmentIndex + 1]] }, scene.project);
          return <path
            key={`hit-${pathIndex}-${segmentIndex}`}
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={16}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            cursor="pointer"
            onMouseEnter={() => setHoveredSegment({ paths: gcodePaths, segment })}
            onMouseLeave={() => setHoveredSegment((current) => current?.paths === gcodePaths && current.segment.pathIndex === pathIndex && current.segment.segmentIndex === segmentIndex ? null : current)}
            onMouseDown={(event) => {
              if (!event.ctrlKey && !event.shiftKey) return;
              event.preventDefault();
              toggleSegmentSelection(segment);
            }}
          />;
        })) : null}
        {nodeMode ? gcodeNodes.map(({ key, point }) => {
          const [cx, cy] = scene.project(point.x, point.y);
          const selected = selectedNodeKeys.includes(key);
          return <circle
            key={`node-${key}`}
            cx={cx}
            cy={cy}
            r={selected ? 7 : 5.5}
            fill={selected ? "#ff4fd8" : "#0a0e13"}
            stroke={selected ? "#fff" : "#6ea8fe"}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
            role="button"
            tabIndex={0}
            aria-label={`G-Code-Knoten X ${formatTick(point.x)}, Y ${formatTick(point.y)}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); toggleNodeSelection(key, event.ctrlKey || event.shiftKey); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") toggleNodeSelection(key, event.ctrlKey || event.shiftKey); }}
            style={{ cursor: "pointer" }}
          />;
        }) : null}
        {selectionBox ? <rect x={selectionBox.minX} y={selectionBox.minY} width={selectionBox.maxX - selectionBox.minX} height={selectionBox.maxY - selectionBox.minY} fill="#6ea8fe22" stroke="#6ea8fe" strokeWidth={1.5} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
        {selectingOrigin ? referencePoints.map((point, index) => {
          const [cx, cy] = scene.project(point.x, point.y);
          const select = () => onSelectOrigin?.(index);
          return <circle key={`origin-${index}`} cx={cx} cy={cy} r={7} fill="#ff5d73" stroke="#fff" strokeWidth={2} role="button" tabIndex={0} aria-label={`Nullpunkt bei X ${formatTick(point.x)}, Y ${formatTick(point.y)} setzen`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); select(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(); }} style={{ cursor: "crosshair" }} />;
        }) : null}
      </svg>
      {isEmpty ? (
        <Stack sx={{ position: "absolute", inset: 0, pointerEvents: "none", alignItems: "center", justifyContent: "center" }} spacing={1}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Noch keine Geometrie geladen</Typography>
          <Typography color="text.secondary">DXF- und G-Code-Dateien oben auswählen oder hineinziehen</Typography>
        </Stack>
      ) : null}
      <Stack direction="row" spacing={2.5} sx={{ position: "absolute", top: 16, right: 18, px: 1.5, py: 0.75, bgcolor: "#0a0e13cc", borderRadius: 1 }}>
        <Legend color="#55d6be" label="DXF-Kontur" />
        <Legend color="#ffb454" label="Fräsbahn" />
        <Legend color="#8a96a8" label="Eilgang" dashed />
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ position: "absolute", left: 18, bottom: 10 }}>Raster: {scene.step.toLocaleString("de-DE")} mm</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)", pointerEvents: "none", whiteSpace: "nowrap" }}>{nodeMode ? "Knoten auswählen · Mausrad: vertikal · Shift + Mausrad: horizontal · Strg + Mausrad: zoomen" : "Links ziehen: auswählen · Mausrad: vertikal · Shift + Mausrad: horizontal · Strg + Mausrad: zoomen"}</Typography>
      {(nodeMode ? selectedNodeKeys.length : selectedSegments.length) ? <Typography variant="caption" sx={{ position: "absolute", left: 18, top: 16, px: 1.25, py: 0.6, bgcolor: "#ff4fd822", color: "#ff8ee6", border: "1px solid #ff4fd866", borderRadius: 1 }}>{nodeMode ? `${selectedNodeKeys.length} Knoten ausgewählt` : `${selectedSegments.length} Segmente ausgewählt`}</Typography> : null}
      <Stack spacing={0.5} sx={{ position: "absolute", right: 18, bottom: 22, bgcolor: "#151b23e6", p: 0.5, borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}>
        <IconButton size="small" color="primary" title="Hineinzoomen" aria-label="In das Koordinatensystem hineinzoomen" onClick={() => zoomAt({ x: WIDTH / 2, y: HEIGHT / 2 }, 1.5)}><AddRounded /></IconButton>
        <IconButton size="small" color="primary" title="Herauszoomen" aria-label="Aus dem Koordinatensystem herauszoomen" onClick={() => zoomAt({ x: WIDTH / 2, y: HEIGHT / 2 }, 1 / 1.5)}><RemoveRounded /></IconButton>
      </Stack>
      {selectingOrigin ? <Typography variant="caption" sx={{ position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)", px: 1.5, py: 0.75, bgcolor: "#ff5d73", color: "#fff", borderRadius: 1, fontWeight: 750 }}>Eckpunkt als X0 / Y0 auswählen</Typography> : null}
    </Box>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}><Box sx={{ width: 18, borderTop: "2px solid", borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} /><Typography variant="caption" color="text.secondary">{label}</Typography></Stack>;
}
