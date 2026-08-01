import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Forward /api/* to the deployed `api` Cloud Function (2nd Gen / Cloud Run).
      // In production, Firebase Hosting rewrites /api/** to the same function.
      "/api": {
        target: "https://api-diez6pxkza-uc.a.run.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
