import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// GitHub Pages base path. Set BASE_PATH env var to override (e.g. "/" for local).
const base = process.env.BASE_PATH ?? "/mneme-ai/";

// Inject the npm version at build time so the dashboard header can show
// what's actually shipped (matches the git tag / npm publish).
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };
const APP_VERSION = pkg.version;

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
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
