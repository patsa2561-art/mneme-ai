import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages base path. Set BASE_PATH env var to override (e.g. "/" for local).
const base = process.env.BASE_PATH ?? "/mneme-ai/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: {
          d3: [
            "d3-force",
            "d3-selection",
            "d3-zoom",
            "d3-drag",
            "d3-scale",
          ],
          react: ["react", "react-dom"],
        },
      },
    },
    target: "es2020",
  },
  server: {
    port: 5173,
    open: false,
  },
});
