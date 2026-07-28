"use client";

import PrecisionManufacturingRounded from "@mui/icons-material/PrecisionManufacturingRounded";
import { Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type { PocketFinishingParameters } from "@/lib/gcode";

export function PocketFinishingControls({ values, enabled, busy, onChange, onPreview }: {
  values: PocketFinishingParameters;
  enabled: boolean;
  busy: boolean;
  onChange: (values: PocketFinishingParameters) => void;
  onPreview: () => void;
}) {
  const field = (key: keyof PocketFinishingParameters, label: string, step: number) => (
    <TextField
      label={label}
      type="number"
      size="small"
      value={values[key]}
      onChange={(event) => onChange({ ...values, [key]: Number(event.target.value) })}
      slotProps={{ htmlInput: { min: 0, step } }}
      fullWidth
    />
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography sx={{ fontWeight: 750 }}>Schruppen und Schlichten</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Vollständigen Taschenpfad markieren. Endmaß und Endtiefe werden automatisch aus dem G-Code ermittelt.
      </Typography>
      <Stack spacing={1.25}>
        {field("allowanceX", "Schlichtzugabe X je Wand (mm)", 0.01)}
        {field("allowanceY", "Schlichtzugabe Y je Wand (mm)", 0.01)}
        {field("allowanceZ", "Schlichtzugabe Boden Z (mm)", 0.01)}
        {field("roughingFeed", "Schruppvorschub (mm/min)", 50)}
        {field("finishingFeed", "Schlichtvorschub (mm/min)", 50)}
        <Button
          variant="contained"
          startIcon={<PrecisionManufacturingRounded />}
          disabled={!enabled || busy}
          onClick={(event) => {
            event.currentTarget.blur();
            onPreview();
          }}
        >
          Analysieren und Vorschau
        </Button>
      </Stack>
    </Paper>
  );
}
