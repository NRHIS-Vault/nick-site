import "dotenv/config"; // Loads .env files so loadEnv can pick them up during build.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  // Load VITE_* variables for the current mode without failing when values are absent.
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Expose env at build time if ever needed for replacement; runtime still uses import.meta.env.
    define: {
      __APP_ENV__: env,
    },
    build: { outDir: "dist" },
    server: { port: 5173 },
  };
});
