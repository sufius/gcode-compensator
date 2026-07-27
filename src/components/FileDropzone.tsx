"use client";

import { useRef, useState } from "react";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";

type Props = {
  title: string;
  description: string;
  accept: string;
  fileName?: string;
  accent: string;
  onFile: (file: File) => void;
};

export function FileDropzone({ title, description, accept, fileName, accent, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <Paper
      variant="outlined"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      sx={{
        p: 2.5,
        borderStyle: "dashed",
        borderWidth: 1.5,
        borderColor: dragging ? accent : "divider",
        bgcolor: dragging ? `${accent}12` : "background.paper",
        transition: "border-color 150ms, background-color 150ms",
      }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        <Box sx={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 2, bgcolor: `${accent}18`, color: accent }}>
          {fileName ? <CheckCircleRounded /> : <UploadFileRounded />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 750 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{fileName ?? description}</Typography>
        </Box>
        {fileName ? <Chip label="Geladen" size="small" sx={{ color: accent }} /> : null}
        <Button variant="outlined" onClick={() => inputRef.current?.click()}>Auswählen</Button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </Stack>
    </Paper>
  );
}
