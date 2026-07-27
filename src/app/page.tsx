"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import AddRounded from "@mui/icons-material/AddRounded";
import ArchitectureRounded from "@mui/icons-material/ArchitectureRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import DeleteForeverRounded from "@mui/icons-material/DeleteForeverRounded";
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";
import Rotate90DegreesCcwRounded from "@mui/icons-material/Rotate90DegreesCcwRounded";
import Rotate90DegreesCwRounded from "@mui/icons-material/Rotate90DegreesCwRounded";
import SaveRounded from "@mui/icons-material/SaveRounded";
import SaveAsRounded from "@mui/icons-material/SaveAsRounded";
import { Alert, Box, Button, Chip, Container, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Slider, Stack, TextField, Typography } from "@mui/material";
import { FileDropzone } from "@/components/FileDropzone";
import { ToolpathViewer } from "@/components/ToolpathViewer";
import { OffsetControls, OffsetDirection } from "@/components/OffsetControls";
import { parseDxf, DxfResult } from "@/lib/dxf";
import { offsetSelectedGCode, parseGCode, GCodeEditMode, GCodeResult } from "@/lib/gcode";
import { Point, transformPaths, transformPoint } from "@/lib/geometry";
import type { LoadedProject, ProjectSummary, ProjectVersion, SaveProjectRequest } from "@/lib/project";

type Loaded<T> = { name: string; content: string; data: T };
type SaveState = "idle" | "dirty" | "saving" | "saved";
const LAST_PROJECT_KEY = "gcode-compensator:last-project";

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
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<ProjectVersion | null>(null);
  const versionOperationRef = useRef(false);

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
    setSaveState("saved");
  }

  async function commitOffset(mode: GCodeEditMode, direction: OffsetDirection, rawValue: number) {
    if (!gcode || !selectedPathIndices.length) return false;
    if (!activeProject) {
      setError("Bitte das Projekt zuerst speichern, bevor eine neue G-Code-Version angelegt wird.");
      return false;
    }
    if (versionOperationRef.current) return false;
    const amount = Math.abs(rawValue);
    const offset = {
      x: direction === "left" ? -amount : direction === "right" ? amount : 0,
      y: direction === "down" ? -amount : direction === "up" ? amount : 0,
    };
    const content = offsetSelectedGCode(gcode.content, gcode.data, selectedPathIndices, offset, mode);
    versionOperationRef.current = true;
    setVersionBusy(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gcode: { name: gcode.name, content },
          dxfTransform: { rotationDegrees: rotation, origin },
          label: `${mode === "translate" ? "Verschoben" : "Länge geändert"}: ${offset.x ? "X" : "Y"} ${(offset.x || offset.y).toLocaleString("de-DE")} mm`,
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
    <Box component="main" sx={{ minHeight: "100vh", background: "radial-gradient(circle at 15% -10%, #283444 0, #0d1117 35%)", py: { xs: 4, md: 7 } }}>
      <Container maxWidth="xl">
        <Stack spacing={4}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}>
            <Box>
              <Stack direction="row" spacing={1.2} sx={{ alignItems: "center", mb: 1.2 }}>
                <ArchitectureRounded color="primary" />
                <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: "0.16em" }}>CNC PATH INSPECTOR</Typography>
              </Stack>
              <Typography variant="h3" component="h1">Werkstück und Werkzeugweg</Typography>
              <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 700 }}>DXF-Konturen und G-Code-Fräsbahnen gemeinsam prüfen – automatisch skaliert und vollständig lokal im Browser verarbeitet.</Typography>
            </Box>
            {(dxf || gcode) ? <Button startIcon={<DeleteOutlineRounded />} color="inherit" onClick={clearView}>Ansicht leeren</Button> : null}
          </Stack>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" } }}>
              <Box sx={{ minWidth: { md: 280 }, flex: 1 }}>
                <Typography sx={{ fontWeight: 750 }}>Arbeitsprojekt</Typography>
                <Typography variant="body2" color="text.secondary">Dateien und Einstellungen werden im Repository unter projects/ gespeichert.</Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="project-select-label">Vorhandenes Projekt</InputLabel>
                <Select labelId="project-select-label" label="Vorhandenes Projekt" value={activeProject ?? ""} onChange={(event) => { if (event.target.value) void openProject(event.target.value); }}>
                  <MenuItem value=""><em>Keines ausgewählt</em></MenuItem>
                  {projects.map((project) => <MenuItem key={project.slug} value={project.slug}>{project.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label="Projektname" size="small" value={projectName} onChange={(event) => { setProjectName(event.target.value); setSaveState("dirty"); }} sx={{ minWidth: 220 }} />
              <Button startIcon={<AddRounded />} color="inherit" onClick={newProject}>Neu</Button>
              {activeProject ? <Button startIcon={<SaveAsRounded />} color="inherit" onClick={() => { setActiveProject(null); setProjectName(`${projectName} Kopie`); setSaveState("dirty"); }}>Speichern unter</Button> : null}
              <Button variant="contained" startIcon={activeProject ? <SaveRounded /> : <FolderOpenRounded />} disabled={saveState === "saving"} onClick={() => void saveCurrentProject()}>
                {saveState === "saving" ? "Speichert …" : activeProject ? "Speichern" : "Projekt anlegen"}
              </Button>
              <Chip size="small" variant="outlined" color={saveState === "dirty" ? "warning" : saveState === "saved" ? "success" : "default"} label={saveState === "saving" ? "Speichert …" : saveState === "dirty" ? "Ungespeichert" : saveState === "saved" ? "Gespeichert" : "Noch nicht gespeichert"} />
            </Stack>
          </Paper>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Box sx={{ flex: 1 }}><FileDropzone title="DXF-Kontur" description=".dxf hier ablegen" accept=".dxf,application/dxf" fileName={dxf?.name} accent="#55d6be" onFile={loadDxf} /></Box>
            <Box sx={{ flex: 1 }}><FileDropzone title="G-Code-Fräsbahn" description=".nc, .gcode, .tap oder .cnc hier ablegen" accept=".nc,.gcode,.tap,.cnc,.ngc,text/plain" fileName={gcode?.name} accent="#ffb454" onFile={(file) => loadFile(file, parseGCode, setGcode)} /></Box>
          </Stack>

          {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}

          <Stack direction={{ xs: "column", lg: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
            <Box sx={{ flex: 1, display: "grid", gridTemplateColumns: { xs: "1fr", xl: "repeat(2, minmax(0, 1fr))" }, gap: 2 }}>
              <OffsetControls
                title="Verschieben"
                description="Bewegt Start und Ende der ausgewählten Bewegung gemeinsam."
                enabled={selectedPathIndices.length > 0}
                selectedCount={selectedPathIndices.length}
                busy={versionBusy}
                onCommit={(direction, value) => commitOffset("translate", direction, value)}
              />
              <OffsetControls
                title="Verlängern / verkürzen"
                description="Verschiebt nur den Endpunkt der ausgewählten Bewegung."
                enabled={selectedPathIndices.length > 0}
                selectedCount={selectedPathIndices.length}
                busy={versionBusy}
                onCommit={(direction, value) => commitOffset("resize", direction, value)}
              />
            </Box>
            <Paper variant="outlined" sx={{ p: 2.5, minWidth: { lg: 280 } }}>
              <Typography sx={{ fontWeight: 750, mb: 1 }}>Projektversion</Typography>
              <FormControl size="small" fullWidth disabled={!activeProject || !versions.length || versionBusy}>
                <InputLabel id="version-select-label">Stand auswählen</InputLabel>
                <Select
                  labelId="version-select-label"
                  label="Stand auswählen"
                  value={currentVersion}
                  onChange={(event) => void switchVersion(event.target.value)}
                  renderValue={(versionId) => {
                    const version = versions.find((item) => item.id === versionId);
                    return version ? `${version.label} · ${new Date(version.createdAt).toLocaleString("de-DE")}` : "";
                  }}
                >
                  {versions.map((version) => (
                    <MenuItem key={version.id} value={version.id} sx={{ gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{version.label} · {new Date(version.createdAt).toLocaleString("de-DE")}</Box>
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`${version.label} löschen`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setVersionToDelete(version); }}
                      >
                        <DeleteForeverRounded fontSize="small" />
                      </IconButton>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Jeder bestätigte Offset erzeugt einen unveränderlichen neuen Stand.</Typography>
            </Paper>
          </Stack>

          <Dialog open={!!versionToDelete} onClose={() => { if (!versionBusy) setVersionToDelete(null); }}>
            <DialogTitle>Delete project version?</DialogTitle>
            <DialogContent>
              <DialogContentText>„{versionToDelete?.label}“ wird aus der Versionshistorie entfernt. Diese Aktion kann nicht rückgängig gemacht werden.</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button color="inherit" disabled={versionBusy} onClick={() => setVersionToDelete(null)}>Cancel</Button>
              <Button color="error" variant="contained" disabled={versionBusy} onClick={() => void deleteSelectedVersion()}>Delete</Button>
            </DialogActions>
          </Dialog>

          {dxf ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction={{ xs: "column", lg: "row" }} spacing={3} sx={{ alignItems: { lg: "center" } }}>
                <Box sx={{ flex: 1, minWidth: 240 }}>
                  <Typography sx={{ fontWeight: 750 }}>DXF drehen</Typography>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 1 }}>
                    <Button aria-label="90 Grad gegen den Uhrzeigersinn drehen" variant="outlined" onClick={() => changeRotation(rotation - 90)}><Rotate90DegreesCcwRounded /></Button>
                    <Slider min={-180} max={180} step={1} value={Math.max(-180, Math.min(180, rotation))} onChange={(_, value) => changeRotation(value as number)} aria-label="DXF-Rotation" />
                    <Button aria-label="90 Grad im Uhrzeigersinn drehen" variant="outlined" onClick={() => changeRotation(rotation + 90)}><Rotate90DegreesCwRounded /></Button>
                    <TextField label="Winkel" type="number" size="small" value={rotation} onChange={(event) => changeRotation(Number(event.target.value) || 0)} slotProps={{ htmlInput: { step: 1 } }} sx={{ width: 110 }} />
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                  <Button variant={selectingOrigin ? "contained" : "outlined"} color={selectingOrigin ? "warning" : "secondary"} startIcon={<MyLocationRounded />} disabled={!dxf.data.referencePoints.length} onClick={() => setSelectingOrigin((value) => !value)}>
                    {selectingOrigin ? "Auswahl abbrechen" : "Nullpunkt auswählen"}
                  </Button>
                  {origin ? <Button color="inherit" startIcon={<RestartAltRounded />} onClick={() => { changeOrigin(null); setSelectingOrigin(false); }}>Nullpunkt zurücksetzen</Button> : null}
                  {origin ? <Chip label={`X0/Y0: ${origin.x.toLocaleString("de-DE", { maximumFractionDigits: 3 })} / ${origin.y.toLocaleString("de-DE", { maximumFractionDigits: 3 })} mm`} color="secondary" variant="outlined" /> : null}
                </Stack>
              </Stack>
              {selectingOrigin ? <Alert severity="info" sx={{ mt: 2 }}>Klicke in der Vorschau auf einen roten Eckpunkt. Dieser Punkt wird anschließend auf X0 / Y0 verschoben.</Alert> : null}
            </Paper>
          ) : null}

          <Paper elevation={8} sx={{ p: { xs: 1.5, md: 2.5 }, border: "1px solid", borderColor: "divider" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 750 }}>2D-Vorschau</Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {dxf ? <Chip size="small" label={`${dxf.data.entityCount} DXF-Elemente`} color="secondary" variant="outlined" /> : null}
                {gcode ? <Chip size="small" label={`${gcode.data.paths.filter((path) => !path.rapid).length} Fräsbewegungen`} color="primary" variant="outlined" /> : null}
                <Chip size="small" label="Einheit: mm" variant="outlined" />
              </Stack>
            </Stack>
            <ToolpathViewer
              dxfPaths={transformedDxfPaths}
              gcodePaths={gcode?.data.paths ?? []}
              referencePoints={transformedReferencePoints}
              selectingOrigin={selectingOrigin}
              onSelectOrigin={(index) => {
                if (!dxf) return;
                changeOrigin(dxf.data.referencePoints[index]);
                setSelectingOrigin(false);
              }}
              onSelectionChange={setSelectedPathIndices}
            />
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
