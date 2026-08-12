import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH ?? (command === "build" ? "/os-v2/" : "/"),
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm"]
        }
      }
    }
  },
  server: {
    port: 5174,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3011",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1/, "").replace(/^\/api/, "")
      },
      "/baolu/api": {
        target: "http://127.0.0.1:3011",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/baolu\/api/, "")
      }
    }
  }
}));
