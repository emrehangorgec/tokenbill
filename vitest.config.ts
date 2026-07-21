import { defineConfig } from "vitest/config";

/**
 * Reports render timestamps in the reader's local time, which is correct for
 * users but makes golden snapshots machine-dependent. Pin the test timezone so
 * snapshots match everywhere (CI runs UTC, contributors do not).
 */
export default defineConfig({
  test: {
    env: { TZ: "UTC" },
  },
});
