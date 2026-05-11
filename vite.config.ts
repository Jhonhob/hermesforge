import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("react-dom") || id.includes("\\react\\") || id.includes("/react/")) {
            return "react-vendor";
          }
          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }
          if (
            id.includes("react-markdown")
            || id.includes("remark-gfm")
            || id.includes("rehype-raw")
            || id.includes("rehype-sanitize")
            || id.includes("unified")
            || id.includes("remark-")
            || id.includes("rehype-")
            || id.includes("mdast-util")
            || id.includes("micromark")
          ) {
            return "markdown-vendor";
          }
          if (id.includes("zustand")) {
            return "state-vendor";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
