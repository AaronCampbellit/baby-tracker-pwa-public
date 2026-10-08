import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/pwa", rollupOptions: { input: "pwa.html" } },
  server: {
    host: "127.0.0.1",
    port: 4175,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
