"use client";

import { useEffect, useRef, useState } from "react";
import { NumberField } from "@base-ui/react/number-field";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";

export type OffsetDirection = "left" | "right" | "up" | "down";

const FieldRoot = styled(NumberField.Root)({ width: "100%" });
const FieldGroup = styled(NumberField.Group)(({ theme }) => ({
  display: "flex",
  alignItems: "stretch",
  overflow: "hidden",
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  background: theme.palette.background.default,
  "&:focus-within": { borderColor: theme.palette.primary.main },
  "&[data-disabled]": { opacity: 0.45 },
}));
const FieldInput = styled(NumberField.Input)(({ theme }) => ({
  width: 82,
  minWidth: 0,
  border: 0,
  outline: 0,
  padding: "9px 6px",
  textAlign: "center",
  font: "inherit",
  color: theme.palette.text.primary,
  background: "transparent",
}));
const StepButton = styled("button")(({ theme }) => ({
  display: "grid",
  placeItems: "center",
  width: 34,
  padding: 0,
  border: 0,
  color: theme.palette.primary.main,
  background: "transparent",
  cursor: "pointer",
  "&:hover": { background: theme.palette.action.hover },
  "&:disabled": { cursor: "default", color: theme.palette.text.disabled },
}));

type Values = Record<OffsetDirection, number>;

function DirectionField({ direction, label, icon, value, min, max, gridColumn, gridRow, enabled, busy, onChange, onCommit }: {
  direction: OffsetDirection;
  label: string;
  icon: React.ReactNode;
  value: number;
  min?: number;
  max?: number;
  gridColumn: number;
  gridRow: number;
  enabled: boolean;
  busy: boolean;
  onChange: (direction: OffsetDirection, value: number) => void;
  onCommit: (direction: OffsetDirection, value: number | null) => void;
}) {
  const currentValueRef = useRef(value);
  useEffect(() => { currentValueRef.current = value; }, [value]);

  return (
    <Box
      sx={{ gridColumn, gridRow }}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onCommit(direction, currentValueRef.current);
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onCommit(direction, currentValueRef.current);
      }}
    >
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5, justifyContent: "center" }}>{icon}<Typography variant="caption" sx={{ fontWeight: 750 }}>{label}</Typography></Stack>
      <FieldRoot
        value={value}
        min={min}
        max={max}
        step={0.1}
        snapOnStep
        disabled={!enabled || busy}
        onValueChange={(next) => {
          currentValueRef.current = next ?? 0;
          onChange(direction, next ?? 0);
        }}
        format={{ minimumFractionDigits: 1, maximumFractionDigits: 3 }}
      >
        <FieldGroup>
          <NumberField.Decrement render={<StepButton aria-label={`${label} reduzieren`} />}><RemoveRounded fontSize="small" /></NumberField.Decrement>
          <FieldInput aria-label={`${label} Offset in Millimetern`} />
          <NumberField.Increment render={<StepButton aria-label={`${label} erhöhen`} />}><AddRounded fontSize="small" /></NumberField.Increment>
        </FieldGroup>
      </FieldRoot>
    </Box>
  );
}

export function OffsetControls({ title, description, selectionNoun = "G-Code-Bewegungen", enabled, selectedCount, busy, onCommit }: {
  title: string;
  description: string;
  selectionNoun?: string;
  enabled: boolean;
  selectedCount: number;
  busy: boolean;
  onCommit: (direction: OffsetDirection, value: number) => Promise<boolean>;
}) {
  const [values, setValues] = useState<Values>({ left: 0, right: 0, up: 0, down: 0 });

  async function commit(direction: OffsetDirection, value: number | null) {
    const offset = value ?? 0;
    if (!offset) return;
    if (await onCommit(direction, offset)) setValues((current) => ({ ...current, [direction]: 0 }));
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: { md: "center" } }}>
        <Box sx={{ minWidth: 220 }}>
          <Typography sx={{ fontWeight: 750 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedCount ? `${selectedCount} ${selectionNoun} ausgewählt` : `Zuerst mindestens ein Element auswählen`}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
          <Typography variant="caption" color="text.secondary">Anwenden mit Enter oder Fokusverlust · ± ändert in 0,1-mm-Schritten</Typography>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(130px, 1fr))", gridTemplateRows: "repeat(3, auto)", gap: 1.25, flex: 1, maxWidth: 650 }}>
          <DirectionField direction="up" label="+Y" icon={<ArrowUpwardRounded />} value={values.up} min={0} gridColumn={2} gridRow={1} enabled={enabled} busy={busy} onChange={(direction, value) => setValues((current) => ({ ...current, [direction]: value }))} onCommit={(direction, value) => void commit(direction, value)} />
          <DirectionField direction="left" label="−X" icon={<ArrowBackRounded />} value={values.left} max={0} gridColumn={1} gridRow={2} enabled={enabled} busy={busy} onChange={(direction, value) => setValues((current) => ({ ...current, [direction]: value }))} onCommit={(direction, value) => void commit(direction, value)} />
          <Box sx={{ gridColumn: 2, gridRow: 2, display: "grid", placeItems: "center", color: "text.secondary", border: "1px dashed", borderColor: "divider", borderRadius: 2 }}><Typography variant="caption">X / Y</Typography></Box>
          <DirectionField direction="right" label="+X" icon={<ArrowForwardRounded />} value={values.right} min={0} gridColumn={3} gridRow={2} enabled={enabled} busy={busy} onChange={(direction, value) => setValues((current) => ({ ...current, [direction]: value }))} onCommit={(direction, value) => void commit(direction, value)} />
          <DirectionField direction="down" label="−Y" icon={<ArrowDownwardRounded />} value={values.down} max={0} gridColumn={2} gridRow={3} enabled={enabled} busy={busy} onChange={(direction, value) => setValues((current) => ({ ...current, [direction]: value }))} onCommit={(direction, value) => void commit(direction, value)} />
        </Box>
      </Stack>
    </Paper>
  );
}
