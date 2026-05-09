import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: {
    outDir: path.resolve(__dirname, "../public/app"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        pricing: path.resolve(__dirname, "pricing/index.html"),
        onboarding: path.resolve(__dirname, "onboarding/index.html"),
        dashboard: path.resolve(__dirname, "dashboard/index.html"),
      },
    },
  },
});
