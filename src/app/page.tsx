"use client";

import { useState } from "react";
import ArchitectureRounded from "@mui/icons-material/ArchitectureRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import { Alert, Box, Button, Chip, Container, Paper, Stack, Typography } from "@mui/material";
import { FileDropzone } from "@/components/FileDropzone";
import { ToolpathViewer } from "@/components/ToolpathViewer";
import { parseDxf, DxfResult } from "@/lib/dxf";
import { parseGCode, GCodeResult } from "@/lib/gcode";

type Loaded<T> = { name: string; data: T };

export default function Home() {
  const [dxf, setDxf] = useState<Loaded<DxfResult> | null>(null);
  const [gcode, setGcode] = useState<Loaded<GCodeResult> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFile<T>(file: File, parser: (content: string) => T, setter: (value: Loaded<T>) => void) {
    try {
      const content = await file.text();
      setter({ name: file.name, data: parser(content) });
      setError(null);
    } catch (reason) {
      setError(`${file.name}: ${reason instanceof Error ? reason.message : "Datei konnte nicht verarbeitet werden."}`);
    }
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
            {(dxf || gcode) ? <Button startIcon={<DeleteOutlineRounded />} color="inherit" onClick={() => { setDxf(null); setGcode(null); setError(null); }}>Ansicht leeren</Button> : null}
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Box sx={{ flex: 1 }}><FileDropzone title="DXF-Kontur" description=".dxf hier ablegen" accept=".dxf,application/dxf" fileName={dxf?.name} accent="#55d6be" onFile={(file) => loadFile(file, parseDxf, setDxf)} /></Box>
            <Box sx={{ flex: 1 }}><FileDropzone title="G-Code-Fräsbahn" description=".nc, .gcode, .tap oder .cnc hier ablegen" accept=".nc,.gcode,.tap,.cnc,.ngc,text/plain" fileName={gcode?.name} accent="#ffb454" onFile={(file) => loadFile(file, parseGCode, setGcode)} /></Box>
          </Stack>

          {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}

          <Paper elevation={8} sx={{ p: { xs: 1.5, md: 2.5 }, border: "1px solid", borderColor: "divider" }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 750 }}>2D-Vorschau</Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {dxf ? <Chip size="small" label={`${dxf.data.entityCount} DXF-Elemente`} color="secondary" variant="outlined" /> : null}
                {gcode ? <Chip size="small" label={`${gcode.data.paths.filter((path) => !path.rapid).length} Fräsbewegungen`} color="primary" variant="outlined" /> : null}
                <Chip size="small" label="Einheit: mm" variant="outlined" />
              </Stack>
            </Stack>
            <ToolpathViewer dxfPaths={dxf?.data.paths ?? []} gcodePaths={gcode?.data.paths ?? []} />
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
