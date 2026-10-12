import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  // env may come from the shell
}

const PORT = 3200;
const external = process.env.BASE_URL; // e.g. a Vercel preview URL (api-load project)
process.env.E2E_ADMIN_SECRET ??= "e2e-secret";

export default defineConfig({
  testDir: "tests",
  // One shared game row in one database: tests must run one at a time, in order.
  workers: 1,
  fullyParallel: false,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    locale: "bg-BG",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "logic", testMatch: /logic\.spec\.ts/ },
    { name: "api-load", testMatch: /api\.spec\.ts/ },
    {
      name: "e2e",
      testMatch: /(e2e|simulation)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: external
    ? undefined
    : {
        // Production build: what Vercel runs. SSE is deliberately short-lived here so every stream
        // reconnects several times during a test run.
        command: `pnpm build && pnpm exec next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/me`,
        timeout: 300_000,
        reuseExistingServer: false,
        env: {
          ADMIN_SECRET: process.env.E2E_ADMIN_SECRET,
          SSE_POLL_MS: "700",
          SSE_MAX_MS: "7000",
        },
      },
});
