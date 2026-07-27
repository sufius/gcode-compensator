"use client";

import { useMemo, useState } from "react";
import ArchitectureRounded from "@mui/icons-material/ArchitectureRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import MyLocationRounded from "@mui/icons-material/MyLocationRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";
import Rotate90DegreesCcwRounded from "@mui/icons-material/Rotate90DegreesCcwRounded";
import Rotate90DegreesCwRounded from "@mui/icons-material/Rotate90DegreesCwRounded";
import { Alert, Box, Button, Chip, Container, Paper, Slider, Stack, TextField, Typography } from "@mui/material";
import { FileDropzone } from "@/components/FileDropzone";
import { ToolpathViewer } from "@/components/ToolpathViewer";
import { parseDxf, DxfResult } from "@/lib/dxf";
import { parseGCode, GCodeResult } from "@/lib/gcode";
import { Point, transformPaths, transformPoint } from "@/lib/geometry";

type Loaded<T> = { name: string; data: T };

export default function Home() {
  const [dxf, setDxf] = useState<Loaded<DxfResult> | null>(null);
  const [gcode, setGcode] = useState<Loaded<GCodeResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const [origin, setOrigin] = useState<Point | null>(null);
  const [selectingOrigin, setSelectingOrigin] = useState(false);

  const transformedDxfPaths = useMemo(() => dxf ? transformPaths(dxf.data.paths, rotation, origin) : [], [dxf, rotation, origin]);
  const transformedReferencePoints = useMemo(() => dxf ? dxf.data.referencePoints.map((point) => transformPoint(point, rotation, origin)) : [], [dxf, rotation, origin]);

  async function loadFile<T>(file: File, parser: (content: string) => T, setter: (value: Loaded<T>) => void) {
    try {
      const content = await file.text();
      setter({ name: file.name, data: parser(content) });
      setError(null);
    } catch (reason) {
      setError(`${file.name}: ${reason instanceof Error ? reason.message : "Datei konnte nicht verarbeitet werden."}`);
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

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Box sx={{ flex: 1 }}><FileDropzone title="DXF-Kontur" description=".dxf hier ablegen" accept=".dxf,application/dxf" fileName={dxf?.name} accent="#55d6be" onFile={loadDxf} /></Box>
            <Box sx={{ flex: 1 }}><FileDropzone title="G-Code-Fräsbahn" description=".nc, .gcode, .tap oder .cnc hier ablegen" accept=".nc,.gcode,.tap,.cnc,.ngc,text/plain" fileName={gcode?.name} accent="#ffb454" onFile={(file) => loadFile(file, parseGCode, setGcode)} /></Box>
          </Stack>

          {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}

          {dxf ? (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction={{ xs: "column", lg: "row" }} spacing={3} sx={{ alignItems: { lg: "center" } }}>
                <Box sx={{ flex: 1, minWidth: 240 }}>
                  <Typography sx={{ fontWeight: 750 }}>DXF drehen</Typography>
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 1 }}>
                    <Button aria-label="90 Grad gegen den Uhrzeigersinn drehen" variant="outlined" onClick={() => setRotation((value) => value - 90)}><Rotate90DegreesCcwRounded /></Button>
                    <Slider min={-180} max={180} step={1} value={Math.max(-180, Math.min(180, rotation))} onChange={(_, value) => setRotation(value as number)} aria-label="DXF-Rotation" />
                    <Button aria-label="90 Grad im Uhrzeigersinn drehen" variant="outlined" onClick={() => setRotation((value) => value + 90)}><Rotate90DegreesCwRounded /></Button>
                    <TextField label="Winkel" type="number" size="small" value={rotation} onChange={(event) => setRotation(Number(event.target.value) || 0)} slotProps={{ htmlInput: { step: 1 } }} sx={{ width: 110 }} />
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                  <Button variant={selectingOrigin ? "contained" : "outlined"} color={selectingOrigin ? "warning" : "secondary"} startIcon={<MyLocationRounded />} disabled={!dxf.data.referencePoints.length} onClick={() => setSelectingOrigin((value) => !value)}>
                    {selectingOrigin ? "Auswahl abbrechen" : "Nullpunkt auswählen"}
                  </Button>
                  {origin ? <Button color="inherit" startIcon={<RestartAltRounded />} onClick={() => { setOrigin(null); setSelectingOrigin(false); }}>Nullpunkt zurücksetzen</Button> : null}
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
                setOrigin(dxf.data.referencePoints[index]);
                setSelectingOrigin(false);
              }}
            />
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
