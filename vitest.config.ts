import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // resvg scans system fonts during startup; too many concurrent native
    // workers make PNG tests exceed Vitest's default timeout on macOS.
    maxWorkers: 4,
  },
});
