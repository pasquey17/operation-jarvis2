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
        app: path.resolve(__dirname, "app/index.html"),
        pricing: path.resolve(__dirname, "app/pricing/index.html"),
        onboarding: path.resolve(__dirname, "app/onboarding/index.html"),
        dashboard: path.resolve(__dirname, "app/dashboard/index.html"),
      },
    },
  },
});
