import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the built files itself; the dev server is for the browser + dev bridge.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", outDir: "dist" },
  test: { environment: "node" },
});
