import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // resvg scans system fonts during startup; too many concurrent native
    // workers make PNG tests exceed Vitest's default timeout on macOS.
    maxWorkers: 4,
    // Exclude parallel-agent git worktrees (see .gitignore) so a full test
    // file/count run reflects only this checkout, not duplicated copies
    // living under .worktrees/*.
    exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**"],
  },
});
