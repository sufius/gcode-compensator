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
};

export function ToolpathViewer({ dxfPaths, gcodePaths, referencePoints = [], selectingOrigin = false, onSelectOrigin }: ViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Point | null>(null);
  const [dragging, setDragging] = useState(false);
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
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0025);
      zoomAt(svgPoint(event.clientX, event.clientY), factor);
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

  const isEmpty = !dxfPaths.length && !gcodePaths.length;

  return (
    <Box sx={{ position: "relative", width: "100%", minHeight: 440, aspectRatio: `${WIDTH}/${HEIGHT}`, bgcolor: "#0a0e13", borderRadius: 2, overflow: "hidden", border: "1px solid", borderColor: "divider" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="Interaktives Koordinatensystem mit DXF-Konturen und G-Code-Werkzeugwegen"
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (event.button !== 2) return;
          event.preventDefault();
          dragRef.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        style={{ cursor: dragging ? "grabbing" : "default", touchAction: "none" }}
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
        {selectingOrigin ? referencePoints.map((point, index) => {
          const [cx, cy] = scene.project(point.x, point.y);
          const select = () => onSelectOrigin?.(index);
          return <circle key={`origin-${index}`} cx={cx} cy={cy} r={7} fill="#ff5d73" stroke="#fff" strokeWidth={2} role="button" tabIndex={0} aria-label={`Nullpunkt bei X ${formatTick(point.x)}, Y ${formatTick(point.y)} setzen`} onClick={(event) => { event.stopPropagation(); select(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(); }} style={{ cursor: "crosshair" }} />;
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
      <Typography variant="caption" color="text.secondary" sx={{ position: "absolute", left: "50%", bottom: 10, transform: "translateX(-50%)", pointerEvents: "none" }}>Strg + Mausrad: zoomen · Rechtsziehen: bewegen</Typography>
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
