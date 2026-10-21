import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": apiOrigin, "/openapi.json": apiOrigin },
  },
});
