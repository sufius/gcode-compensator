"use client";

import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#ffb454" },
    secondary: { main: "#55d6be" },
    background: { default: "#0d1117", paper: "#151b23" },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h3: { fontWeight: 750, letterSpacing: "-0.035em" },
    button: { textTransform: "none", fontWeight: 700 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  },
});
