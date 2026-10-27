import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Type-check the tests too: tsc runs on test/tsconfig.json (src + test + this file) and any type error,
    // in a *.test-d.ts file or elsewhere ("source errors"), fails the run. tsconfig.json stays src-only for the build.
    typecheck: {
      enabled: true,
      tsconfig: "./test/tsconfig.json",
      include: ["test/**/*.test-d.ts"],
    },
  },
});
