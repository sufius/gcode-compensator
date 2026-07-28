"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import AddRounded from "@mui/icons-material/AddRounded";
import ArchitectureRounded from "@mui/icons-material/ArchitectureRounded";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import FileUploadRounded from "@mui/icons-material/FileUploadRounded";
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import PolylineRounded from "@mui/icons-material/PolylineRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";
import Rotate90DegreesCcwRounded from "@mui/icons-material/Rotate90DegreesCcwRounded";
import Rotate90DegreesCwRounded from "@mui/icons-material/Rotate90DegreesCwRounded";
import SaveRounded from "@mui/icons-material/SaveRounded";
import SaveAsRounded from "@mui/icons-material/SaveAsRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Drawer, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Slider, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { FileDropzone } from "@/components/FileDropzone";
import { ToolpathViewer } from "@/components/ToolpathViewer";
import { OffsetControls, OffsetDirection } from "@/components/OffsetControls";
import { PocketFinishingControls } from "@/components/PocketFinishingControls";
import { parseDxf, DxfResult } from "@/lib/dxf";
import { createPocketRoughingAndFinishing, offsetSelectedGCode, offsetSelectedGCodeNodes, offsetSelectedGCodeZ, parseGCode, GCodeResult, PocketFinishingParameters, PocketPassResult } from "@/lib/gcode";
import { Point, transformPaths, transformPoint } from "@/lib/geometry";
import type { LoadedProject, ProjectSummary, ProjectVersion, SaveProjectRequest } from "@/lib/project";

type Loaded<T> = { name: string; content: string; data: T };
type SaveState = "idle" | "dirty" | "saving" | "saved";
const LAST_PROJECT_KEY = "gcode-compensator:last-project";
const DRAWER_WIDTH = 400;
const MINI_DRAWER_WIDTH = 72;

function rememberProject(slug: string) {
  try { window.localStorage.setItem(LAST_PROJECT_KEY, slug); } catch { /* Storage kann im privaten Modus gesperrt sein. */ }
}

function forgetProject() {
  try { window.localStorage.removeItem(LAST_PROJECT_KEY); } catch { /* Storage kann im privaten Modus gesperrt sein. */ }
}

function rememberedProject() {
  try { return window.localStorage.getItem(LAST_PROJECT_KEY); } catch { return null; }
}

export default function Home() {
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);
  return hydrated ? <HomeContent /> : null;
}

function subscribeToHydration() {
  return () => undefined;
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function HomeContent() {
  const [dxf, setDxf] = useState<Loaded<DxfResult> | null>(null);
  const [gcode, setGcode] = useState<Loaded<GCodeResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [origin, setOrigin] = useState<Point | null>(null);
  const [selectingOrigin, setSelectingOrigin] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [selectedPathIndices, setSelectedPathIndices] = useState<number[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<Point[]>([]);
  const [nodeMode, setNodeMode] = useState(false);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<ProjectVersion | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [pocketParameters, setPocketParameters] = useState<PocketFinishingParameters>({ allowanceX: 0.1, allowanceY: 0.1, allowanceZ: 0.1, roughingFeed: 1200, finishingFeed: 600 });
  const [pocketPreview, setPocketPreview] = useState<PocketPassResult | null>(null);
  const versionOperationRef = useRef(false);

  const handlePathSelectionChange = useCallback((indices: number[]) => {
    setSelectedPathIndices(indices);
    setPocketPreview(null);
  }, []);

  const transformedDxfPaths = useMemo(() => dxf ? transformPaths(dxf.data.paths, rotation, origin) : [], [dxf, rotation, origin]);
  const transformedReferencePoints = useMemo(() => dxf ? dxf.data.referencePoints.map((point) => transformPoint(point, rotation, origin)) : [], [dxf, rotation, origin]);

  async function loadFile<T>(file: File, parser: (content: string) => T, setter: (value: Loaded<T>) => void) {
    try {
      const content = await file.text();
      setter({ name: file.name, content, data: parser(content) });
      setSaveState("dirty");
      setError(null);
    } catch (reason) {
      setError(`${file.name}: ${reason instanceof Error ? reason.message : "Datei konnte nicht verarbeitet werden."}`);
    }
  }

  const refreshProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const result = await response.json() as { projects?: ProjectSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error);
      setProjects(result.projects ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Projekte konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshProjects(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshProjects]);

  const saveTransform = useCallback(async (slug: string, nextRotation: number, nextOrigin: Point | null) => {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dxfTransform: { rotationDegrees: nextRotation, origin: nextOrigin } } satisfies SaveProjectRequest),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setSaveState("saved");
      void refreshProjects();
    } catch (reason) {
      setSaveState("dirty");
      setError(reason instanceof Error ? reason.message : "Änderungen konnten nicht gespeichert werden.");
    }
  }, [refreshProjects]);

  useEffect(() => {
    if (!activeProject) return;
    const timer = window.setTimeout(() => void saveTransform(activeProject, rotation, origin), 700);
    return () => window.clearTimeout(timer);
  }, [activeProject, origin, rotation, saveTransform]);

  function changeRotation(value: number) {
    setRotation(value);
    if (activeProject) setSaveState("dirty");
  }

  function changeOrigin(value: Point | null) {
    setOrigin(value);
    if (activeProject) setSaveState("dirty");
  }

  const openProject = useCallback(async (slug: string) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { cache: "no-store" });
      const project = await response.json() as LoadedProject & { error?: string };
      if (!response.ok) throw new Error(project.error);
      const loadedDxf = project.contents.dxf && project.manifest.files.dxf
        ? { name: project.manifest.files.dxf.originalName, content: project.contents.dxf, data: parseDxf(project.contents.dxf) }
        : null;
      const loadedGcode = project.contents.gcode && project.manifest.files.gcode
        ? { name: project.manifest.files.gcode.originalName, content: project.contents.gcode, data: parseGCode(project.contents.gcode) }
        : null;
      setDxf(loadedDxf);
      setGcode(loadedGcode);
      setRotation(project.manifest.dxfTransform.rotationDegrees);
      setOrigin(project.manifest.dxfTransform.origin);
      setProjectName(project.manifest.name);
      setSelectingOrigin(false);
      setActiveProject(project.slug);
      rememberProject(project.slug);
      setVersions(project.manifest.versions ?? []);
      setCurrentVersion(project.manifest.currentVersion ?? "");
      setSaveState("saved");
      setError(null);
    } catch (reason) {
      forgetProject();
      setError(reason instanceof Error ? reason.message : "Projekt konnte nicht geöffnet werden.");
    }
  }, []);

  useEffect(() => {
    const slug = rememberedProject();
    if (!slug) return;
    const timer = window.setTimeout(() => void openProject(slug), 0);
    return () => window.clearTimeout(timer);
  }, [openProject]);

  async function saveCurrentProject() {
    if (!projectName.trim()) {
      setError("Bitte zuerst einen Projektnamen eingeben.");
      return;
    }
    setSaveState("saving");
    try {
      const body: SaveProjectRequest = {
        name: projectName,
        files: activeProject ? undefined : {
          dxf: dxf ? { name: dxf.name, content: dxf.content } : null,
          gcode: gcode ? { name: gcode.name, content: gcode.content } : null,
        },
        dxfTransform: { rotationDegrees: rotation, origin },
      };
      const response = await fetch(activeProject ? `/api/projects/${encodeURIComponent(activeProject)}` : "/api/projects", {
        method: activeProject ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { slug?: string; manifest?: { versions?: ProjectVersion[]; currentVersion?: string }; error?: string };
      if (!response.ok || !result.slug) throw new Error(result.error ?? "Projekt konnte nicht gespeichert werden.");
      setActiveProject(result.slug);
      rememberProject(result.slug);
      setVersions(result.manifest?.versions ?? versions);
      setCurrentVersion(result.manifest?.currentVersion ?? currentVersion);
      setSaveState("saved");
      setError(null);
      await refreshProjects();
    } catch (reason) {
      setSaveState("dirty");
      setError(reason instanceof Error ? reason.message : "Projekt konnte nicht gespeichert werden.");
    }
  }

  async function renameCurrentProject() {
    if (!activeProject || !projectNameDraft.trim()) return;
    setProjectBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectNameDraft.trim() } satisfies SaveProjectRequest),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error);
      setProjectName(projectNameDraft.trim());
      setEditProjectOpen(false);
      setSaveState("saved");
      setError(null);
      await refreshProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Projektname konnte nicht geändert werden.");
    } finally {
      setProjectBusy(false);
    }
  }

  async function deleteCurrentProject() {
    if (!activeProject) return;
    setProjectBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Projekt konnte nicht gelöscht werden.");
      }
      setDeleteProjectOpen(false);
      newProject();
      await refreshProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Projekt konnte nicht gelöscht werden.");
    } finally {
      setProjectBusy(false);
    }
  }

  function newProject() {
    clearView();
    setActiveProject(null);
    forgetProject();
    setProjectName("");
    setSaveState("idle");
    setVersions([]);
    setCurrentVersion("");
  }

  function applyLoadedVersion(project: LoadedProject) {
    if (project.contents.gcode && project.manifest.files.gcode) {
      setGcode({ name: project.manifest.files.gcode.originalName, content: project.contents.gcode, data: parseGCode(project.contents.gcode) });
    }
    setRotation(project.manifest.dxfTransform.rotationDegrees);
    setOrigin(project.manifest.dxfTransform.origin);
    setVersions(project.manifest.versions ?? []);
    setCurrentVersion(project.manifest.currentVersion ?? "");
    setSelectedPathIndices([]);
    setSelectedNodes([]);
    setSaveState("saved");
  }

  async function commitOffset(direction: OffsetDirection, rawValue: number) {
    const isZOffset = direction === "zPlus" || direction === "zMinus";
    if (!gcode) return false;
    const selectionCount = isZOffset
      ? selectedPathIndices.filter((index) => gcode.data.paths[index]?.gcode?.hasExplicitZ).length
      : nodeMode ? selectedNodes.length : selectedPathIndices.length;
    if (!selectionCount) return false;
    if (!activeProject) {
      setError("Bitte das Projekt zuerst speichern, bevor eine neue G-Code-Version angelegt wird.");
      return false;
    }
    if (versionOperationRef.current) return false;
    const amount = Math.abs(rawValue);
    const zOffset = direction === "zPlus" ? amount : direction === "zMinus" ? -amount : 0;
    const offset = {
      x: direction === "left" ? -amount : direction === "right" ? amount : 0,
      y: direction === "down" ? -amount : direction === "up" ? amount : 0,
    };
    const content = zOffset
      ? offsetSelectedGCodeZ(gcode.content, gcode.data, selectedPathIndices, zOffset)
      : nodeMode
        ? offsetSelectedGCodeNodes(gcode.content, gcode.data, selectedNodes, offset)
        : offsetSelectedGCode(gcode.content, gcode.data, selectedPathIndices, offset);
    versionOperationRef.current = true;
    setVersionBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gcode: { name: gcode.name, content },
          dxfTransform: { rotationDegrees: rotation, origin },
          label: `${nodeMode && !zOffset ? "Knoten" : "Bewegung"} verschoben: ${zOffset ? "Z" : offset.x ? "X" : "Y"} ${(zOffset || offset.x || offset.y).toLocaleString("de-DE")} mm`,
        }),
      });
      const project = await response.json() as LoadedProject & { error?: string };
      if (!response.ok) throw new Error(project.error);
      applyLoadedVersion(project);
      setError(null);
      await refreshProjects();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "G-Code-Version konnte nicht gespeichert werden.");
      return false;
    } finally {
      versionOperationRef.current = false;
      setVersionBusy(false);
    }
  }

  function previewPocketPasses() {
    if (!gcode) return;
    try {
      setPocketPreview(createPocketRoughingAndFinishing(gcode.content, gcode.data, selectedPathIndices, pocketParameters));
      setError(null);
    } catch (reason) {
      setPocketPreview(null);
      setError(reason instanceof Error ? reason.message : "Der Taschenpfad konnte nicht analysiert werden.");
    }
  }

  async function savePocketPasses() {
    if (!gcode || !pocketPreview) return;
    if (!activeProject) {
      setPocketPreview(null);
      setError("Bitte das Projekt zuerst speichern, bevor eine neue G-Code-Version angelegt wird.");
      return;
    }
    if (versionOperationRef.current) return;
    versionOperationRef.current = true;
    setVersionBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gcode: { name: gcode.name, content: pocketPreview.content },
          dxfTransform: { rotationDegrees: rotation, origin },
          label: `Schruppen + Schlichten · Zugabe X/Y/Z ${pocketParameters.allowanceX.toLocaleString("de-DE")}/${pocketParameters.allowanceY.toLocaleString("de-DE")}/${pocketParameters.allowanceZ.toLocaleString("de-DE")} mm`,
        }),
      });
      const project = await response.json() as LoadedProject & { error?: string };
      if (!response.ok) throw new Error(project.error);
      applyLoadedVersion(project);
      setPocketPreview(null);
      setError(null);
      await refreshProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Schrupp- und Schlichtversion konnte nicht gespeichert werden.");
    } finally {
      versionOperationRef.current = false;
      setVersionBusy(false);
    }
  }

  async function switchVersion(versionId: string) {
    if (!activeProject || versionOperationRef.current) return;
    versionOperationRef.current = true;
    setVersionBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/versions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const project = await response.json() as LoadedProject & { error?: string };
      if (!response.ok) throw new Error(project.error);
      applyLoadedVersion(project);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Projektversion konnte nicht geladen werden.");
    } finally {
      versionOperationRef.current = false;
      setVersionBusy(false);
    }
  }

  async function deleteSelectedVersion() {
    if (!activeProject || !versionToDelete || versionOperationRef.current) return;
    versionOperationRef.current = true;
    setVersionBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/versions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: versionToDelete.id }),
      });
      const project = await response.json() as LoadedProject & { error?: string };
      if (!response.ok) throw new Error(project.error);
      applyLoadedVersion(project);
      setVersionToDelete(null);
      setError(null);
      await refreshProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Projektversion konnte nicht gelöscht werden.");
    } finally {
      versionOperationRef.current = false;
      setVersionBusy(false);
    }
  }

  function downloadCurrentGCode() {
    if (!gcode) return;
    const blob = new Blob([gcode.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = gcode.name || "toolpath.gcode";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadDxf(file: File) {
    await loadFile(file, parseDxf, (value) => {
      setDxf(value);
      setRotation(0);
      setOrigin(null);
      setSelectingOrigin(false);
    });
  }

  function clearView() {
    setDxf(null);
    setGcode(null);
    setError(null);
    setRotation(0);
    setOrigin(null);
    setSelectingOrigin(false);
    setSaveState("dirty");
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default", background: "radial-gradient(circle at 15% -10%, #283444 0, #0d1117 35%)" }}>
      <Drawer
        variant="permanent"
        open={drawerOpen}
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : MINI_DRAWER_WIDTH,
          flexShrink: 0,
          transition: (theme) => theme.transitions.create("width"),
          "& .MuiDrawer-paper": {
            width: drawerOpen ? DRAWER_WIDTH : MINI_DRAWER_WIDTH,
            boxSizing: "border-box",
            overflowX: "hidden",
            transition: (theme) => theme.transitions.create("width"),
            borderColor: "divider",
          },
        }}
      >
        <Stack direction="row" sx={{ height: 64, px: drawerOpen ? 2 : 1, alignItems: "center", justifyContent: drawerOpen ? "space-between" : "center", flexShrink: 0 }}>
          {drawerOpen ? <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}><ArchitectureRounded color="primary" /><Typography noWrap sx={{ fontWeight: 800 }}>CNC Path Inspector</Typography></Stack> : null}
          <IconButton aria-label={drawerOpen ? "Seitenleiste einklappen" : "Seitenleiste ausklappen"} onClick={() => setDrawerOpen((value) => !value)}>
            {drawerOpen ? <ChevronLeftRounded /> : <ChevronRightRounded />}
          </IconButton>
        </Stack>
        <Divider />

        {!drawerOpen ? (
          <Stack spacing={1} sx={{ alignItems: "center", py: 2 }}>
            {[
              { label: "Projekte", icon: <FolderOpenRounded /> },
              { label: "Dateien", icon: <FileUploadRounded /> },
              { label: "DXF ausrichten", icon: <TuneRounded /> },
              { label: "Versionen", icon: <HistoryRounded /> },
            ].map((item) => <Tooltip key={item.label} title={item.label} placement="right"><IconButton aria-label={item.label} onClick={() => setDrawerOpen(true)}>{item.icon}</IconButton></Tooltip>)}
          </Stack>
        ) : (
          <Stack spacing={2.5} sx={{ p: 2, overflowY: "auto", overflowX: "hidden" }}>
            <Box>
              <Typography variant="overline" color="text.secondary">Arbeitsprojekt</Typography>
              <FormControl size="small" fullWidth sx={{ mt: 1 }}>
                <InputLabel id="project-select-label">Vorhandenes Projekt</InputLabel>
                <Select labelId="project-select-label" label="Vorhandenes Projekt" value={activeProject ?? ""} onChange={(event) => { if (event.target.value) void openProject(event.target.value); }}>
                  <MenuItem value=""><em>Keines ausgewählt</em></MenuItem>
                  {projects.map((project) => <MenuItem key={project.slug} value={project.slug}>{project.name}</MenuItem>)}
                </Select>
              </FormControl>
              {activeProject ? (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 1.5 }}>
                  <Typography noWrap sx={{ flex: 1, fontWeight: 750 }}>{projectName}</Typography>
                  <Tooltip title="Projektname bearbeiten"><IconButton size="small" aria-label="Projektname bearbeiten" onClick={() => { setProjectNameDraft(projectName); setEditProjectOpen(true); }}><EditRounded fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Projekt vollständig löschen"><IconButton size="small" color="error" aria-label="Projekt vollständig löschen" onClick={() => setDeleteProjectOpen(true)}><DeleteForeverRounded fontSize="small" /></IconButton></Tooltip>
                </Stack>
              ) : <TextField label="Projektname" size="small" fullWidth value={projectName} onChange={(event) => { setProjectName(event.target.value); setSaveState("dirty"); }} sx={{ mt: 1.5 }} />}
              <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.5, flexWrap: "wrap" }}>
                <Button size="small" startIcon={<AddRounded />} color="inherit" onClick={newProject}>Neu</Button>
                {activeProject ? <Button size="small" startIcon={<SaveAsRounded />} color="inherit" onClick={() => { setActiveProject(null); setProjectName(`${projectName} Kopie`); setSaveState("dirty"); }}>Kopie</Button> : null}
                <Button size="small" variant="contained" startIcon={activeProject ? <SaveRounded /> : <FolderOpenRounded />} disabled={saveState === "saving"} onClick={() => void saveCurrentProject()}>{saveState === "saving" ? "Speichert …" : activeProject ? "Speichern" : "Anlegen"}</Button>
              </Stack>
              <Chip sx={{ mt: 1.5 }} size="small" variant="outlined" color={saveState === "dirty" ? "warning" : saveState === "saved" ? "success" : "default"} label={saveState === "saving" ? "Speichert …" : saveState === "dirty" ? "Ungespeichert" : saveState === "saved" ? "Gespeichert" : "Noch nicht gespeichert"} />
            </Box>

            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">Dateien</Typography>
              <Stack spacing={1.25} sx={{ mt: 1 }}>
                <FileDropzone title="DXF-Kontur" description=".dxf auswählen" accept=".dxf,application/dxf" fileName={dxf?.name} accent="#55d6be" onFile={loadDxf} />
                <FileDropzone title="G-Code" description=".nc, .gcode, .tap oder .cnc" accept=".nc,.gcode,.tap,.cnc,.ngc,text/plain" fileName={gcode?.name} accent="#ffb454" onFile={(file) => loadFile(file, parseGCode, setGcode)} />
              </Stack>
              {(dxf || gcode) ? <Button sx={{ mt: 1 }} size="small" startIcon={<DeleteOutlineRounded />} color="inherit" onClick={clearView}>Ansicht leeren</Button> : null}
            </Box>

            {dxf ? <><Divider /><Box>
              <Typography variant="overline" color="text.secondary">DXF ausrichten</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
                <IconButton aria-label="90 Grad gegen den Uhrzeigersinn drehen" onClick={() => changeRotation(rotation - 90)}><Rotate90DegreesCcwRounded /></IconButton>
                <Slider min={-180} max={180} step={1} value={Math.max(-180, Math.min(180, rotation))} onChange={(_, value) => changeRotation(value as number)} aria-label="DXF-Rotation" />
                <IconButton aria-label="90 Grad im Uhrzeigersinn drehen" onClick={() => changeRotation(rotation + 90)}><Rotate90DegreesCwRounded /></IconButton>
                <TextField label="°" type="number" size="small" value={rotation} onChange={(event) => changeRotation(Number(event.target.value) || 0)} slotProps={{ htmlInput: { step: 1 } }} sx={{ width: 78 }} />
              </Stack>
              <Button fullWidth sx={{ mt: 1.5 }} variant={selectingOrigin ? "contained" : "outlined"} color={selectingOrigin ? "warning" : "secondary"} startIcon={<MyLocationRounded />} disabled={!dxf.data.referencePoints.length} onClick={() => setSelectingOrigin((value) => !value)}>{selectingOrigin ? "Auswahl abbrechen" : "Nullpunkt auswählen"}</Button>
              {origin ? <Button fullWidth sx={{ mt: 0.5 }} color="inherit" startIcon={<RestartAltRounded />} onClick={() => { changeOrigin(null); setSelectingOrigin(false); }}>Nullpunkt zurücksetzen</Button> : null}
              {origin ? <Typography variant="caption" color="secondary.main">X0/Y0: {origin.x.toLocaleString("de-DE", { maximumFractionDigits: 3 })} / {origin.y.toLocaleString("de-DE", { maximumFractionDigits: 3 })} mm</Typography> : null}
            </Box></> : null}

            <Divider />
            <Box>
              <Typography variant="overline" color="text.secondary">Projektversion</Typography>
              <FormControl size="small" fullWidth disabled={!activeProject || !versions.length || versionBusy} sx={{ mt: 1 }}>
                <InputLabel id="version-select-label">Stand auswählen</InputLabel>
                <Select labelId="version-select-label" label="Stand auswählen" value={currentVersion} onChange={(event) => void switchVersion(event.target.value)} renderValue={(versionId) => versions.find((item) => item.id === versionId)?.label ?? ""}>
                  {versions.map((version) => <MenuItem key={version.id} value={version.id} sx={{ gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{version.label} · {new Date(version.createdAt).toLocaleString("de-DE")}</Box>
                    <IconButton size="small" color="error" aria-label={`${version.label} löschen`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setVersionToDelete(version); }}><DeleteForeverRounded fontSize="small" /></IconButton>
                  </MenuItem>)}
                </Select>
              </FormControl>
              <Button
                fullWidth
                sx={{ mt: 1.25 }}
                variant="outlined"
                startIcon={<DownloadRounded />}
                disabled={!gcode || versionBusy}
                onClick={downloadCurrentGCode}
              >
                Ausgewählten G-Code herunterladen
              </Button>
            </Box>
          </Stack>
        )}
      </Drawer>

      <Box component="main" sx={{ minWidth: 0, width: `calc(100vw - ${drawerOpen ? DRAWER_WIDTH : MINI_DRAWER_WIDTH}px)`, height: "100vh", p: 2, display: "flex", flexDirection: "column", gap: 2, overflow: "hidden", transition: (theme) => theme.transitions.create("width") }}>
        <Stack direction="row" spacing={2} sx={{ minHeight: 48, alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h1" noWrap sx={{ fontWeight: 750 }}>{projectName || "Werkstück und Werkzeugweg"}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>Koordinatensystem und Jog-Steuerung</Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {dxf ? <Chip size="small" label={`${dxf.data.entityCount} DXF`} color="secondary" variant="outlined" /> : null}
            {gcode ? <Chip size="small" label={`${gcode.data.paths.filter((path) => !path.rapid).length} Fräsbewegungen`} color="primary" variant="outlined" /> : null}
            <Tooltip title={nodeMode ? "Knotenwerkzeug deaktivieren" : "Knotenwerkzeug aktivieren"}><IconButton color={nodeMode ? "primary" : "default"} aria-pressed={nodeMode} aria-label="Knotenwerkzeug" onClick={() => setNodeMode((value) => !value)}><PolylineRounded /></IconButton></Tooltip>
          </Stack>
        </Stack>
        {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
        {selectingOrigin ? <Alert severity="info">Klicke im Koordinatensystem auf einen roten Eckpunkt.</Alert> : null}
        <Box sx={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) minmax(210px, 16vw)" }, gap: 2, overflow: { xs: "auto", lg: "hidden" } }}>
          <Paper elevation={8} sx={{ minHeight: { xs: 500, lg: 0 }, p: 1.5, border: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column" }}>
            <ToolpathViewer fill dxfPaths={transformedDxfPaths} gcodePaths={gcode?.data.paths ?? []} referencePoints={transformedReferencePoints} selectingOrigin={selectingOrigin} onSelectOrigin={(index) => { if (!dxf) return; changeOrigin(dxf.data.referencePoints[index]); setSelectingOrigin(false); }} onSelectionChange={handlePathSelectionChange} nodeMode={nodeMode} onNodeSelectionChange={setSelectedNodes} />
          </Paper>
          <Box sx={{ minHeight: { xs: 480, lg: 0 }, overflow: "auto" }}>
            <Stack spacing={2}>
              <PocketFinishingControls values={pocketParameters} enabled={!!gcode && !nodeMode && selectedPathIndices.length > 0} busy={versionBusy} onChange={(values) => { setPocketParameters(values); setPocketPreview(null); }} onPreview={previewPocketPasses} />
              <OffsetControls compact title={nodeMode ? "Knoten verschieben" : "Jog"} description={nodeMode ? "Addiert den Offset auf jeden ausgewählten Koordinatenknoten." : "Bewegt Start und Ende der ausgewählten Bewegung gemeinsam."} selectionNoun={nodeMode ? "Knoten" : "G-Code-Bewegungen"} enabled={(nodeMode ? selectedNodes.length : selectedPathIndices.length) > 0} zEnabled={!nodeMode && selectedPathIndices.some((index) => gcode?.data.paths[index]?.gcode?.hasExplicitZ)} selectedCount={nodeMode ? selectedNodes.length : selectedPathIndices.length} busy={versionBusy} onCommit={commitOffset} />
            </Stack>
          </Box>
        </Box>
      </Box>

      <Dialog open={editProjectOpen} onClose={() => { if (!projectBusy) setEditProjectOpen(false); }} fullWidth maxWidth="xs">
        <DialogTitle>Projektname bearbeiten</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth label="Projektname" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} sx={{ mt: 1 }} /></DialogContent>
        <DialogActions><Button color="inherit" disabled={projectBusy} onClick={() => setEditProjectOpen(false)}>Abbrechen</Button><Button variant="contained" disabled={projectBusy || !projectNameDraft.trim()} onClick={() => void renameCurrentProject()}>Speichern</Button></DialogActions>
      </Dialog>
      <Dialog open={deleteProjectOpen} onClose={() => { if (!projectBusy) setDeleteProjectOpen(false); }} fullWidth maxWidth="sm">
        <DialogTitle>Projekt endgültig löschen?</DialogTitle>
        <DialogContent><Alert severity="warning" sx={{ mb: 2 }}>Diese Aktion kann nicht rückgängig gemacht werden.</Alert><DialogContentText>Das Projekt „{projectName}“ und der komplette Ordner <strong>projects/{activeProject}</strong> werden einschließlich aller Eingabedateien und Versionen dauerhaft gelöscht.</DialogContentText></DialogContent>
        <DialogActions><Button color="inherit" disabled={projectBusy} onClick={() => setDeleteProjectOpen(false)}>Abbrechen</Button><Button color="error" variant="contained" startIcon={<DeleteForeverRounded />} disabled={projectBusy} onClick={() => void deleteCurrentProject()}>{projectBusy ? "Löscht …" : "Projekt und Ordner löschen"}</Button></DialogActions>
      </Dialog>
      <Dialog open={!!versionToDelete} onClose={() => { if (!versionBusy) setVersionToDelete(null); }}>
        <DialogTitle>Projektversion löschen?</DialogTitle><DialogContent><DialogContentText>„{versionToDelete?.label}“ wird aus der Versionshistorie entfernt. Diese Aktion kann nicht rückgängig gemacht werden.</DialogContentText></DialogContent>
        <DialogActions><Button color="inherit" disabled={versionBusy} onClick={() => setVersionToDelete(null)}>Abbrechen</Button><Button color="error" variant="contained" disabled={versionBusy} onClick={() => void deleteSelectedVersion()}>Löschen</Button></DialogActions>
      </Dialog>
      <Dialog open={!!pocketPreview} onClose={() => { if (!versionBusy) setPocketPreview(null); }} fullWidth maxWidth="sm">
        <DialogTitle>Schruppen und Schlichten prüfen</DialogTitle>
        <DialogContent>
          {pocketPreview ? <Stack spacing={1.5}>
            <Alert severity="info">Der ausgewählte Block (Zeilen {pocketPreview.summary.startLine + 1}–{pocketPreview.summary.endLine + 1}) wird vollständig zweimal gefahren.</Alert>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 0.75 }}>
              {[
                ["Endmaß X / Y", `${pocketPreview.summary.endSizeX.toLocaleString("de-DE", { maximumFractionDigits: 5 })} × ${pocketPreview.summary.endSizeY.toLocaleString("de-DE", { maximumFractionDigits: 5 })} mm`],
                ["Schruppmaß X / Y", `${pocketPreview.summary.roughSizeX.toLocaleString("de-DE", { maximumFractionDigits: 5 })} × ${pocketPreview.summary.roughSizeY.toLocaleString("de-DE", { maximumFractionDigits: 5 })} mm`],
                ["Endtiefe Z", `${pocketPreview.summary.endDepth.toLocaleString("de-DE", { maximumFractionDigits: 5 })} mm`],
                ["Schrupp-Endtiefe Z", `${pocketPreview.summary.roughDepth.toLocaleString("de-DE", { maximumFractionDigits: 5 })} mm`],
                ["Schruppvorschub", `${pocketPreview.summary.roughingFeed.toLocaleString("de-DE")} mm/min`],
                ["Schlichtvorschub", `${pocketPreview.summary.finishingFeed.toLocaleString("de-DE")} mm/min`],
                ["Taschenmittelpunkt", `X ${pocketPreview.summary.center.x.toLocaleString("de-DE", { maximumFractionDigits: 5 })} / Y ${pocketPreview.summary.center.y.toLocaleString("de-DE", { maximumFractionDigits: 5 })} mm`],
              ].map(([label, value]) => <Box key={label} sx={{ display: "contents" }}><Typography color="text.secondary">{label}</Typography><Typography sx={{ textAlign: "right", fontWeight: 700 }}>{value}</Typography></Box>)}
            </Box>
            {pocketPreview.summary.convertedArcCount ? <Alert severity="warning">{pocketPreview.summary.convertedArcCount} Kreisbogen/-bögen werden wegen unterschiedlicher X-/Y-Skalierung als feine G1-Segmente ausgegeben.</Alert> : null}
            <Alert severity="success"><Stack spacing={0.5}>{pocketPreview.summary.checks.map((check) => <Typography variant="body2" key={check}>✓ {check}</Typography>)}</Stack></Alert>
          </Stack> : null}
        </DialogContent>
        <DialogActions><Button color="inherit" disabled={versionBusy} onClick={() => setPocketPreview(null)}>Abbrechen</Button><Button variant="contained" disabled={versionBusy} onClick={() => void savePocketPasses()}>{versionBusy ? "Speichert …" : "Als neue Version speichern"}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
