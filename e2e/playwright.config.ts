import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

// Resolved from this file rather than from process.cwd(): the config is run
// both as the e2e workspace's own `npm test` (cwd e2e/) and from the repo root
// with --config. A relative ".." silently resolved outside the repository in
// the second case, the CLI call failed, and the entire authenticated suite
// skipped itself while still reporting success.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The signed-out smoke test only needs the Worker to boot, so it runs against a
// placeholder Supabase key. Authenticated specs need a real local stack.
//
// Rather than hardcoding the local keys -- which would rot, and would put
// key-shaped strings in the repository -- ask the Supabase CLI for them at
// config load. If that fails (stack stopped, Docker down, or CI) the
// authenticated specs skip themselves and the smoke test still runs.
type LocalStack = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  mailpitUrl: string;
};

function resolveLocalStack(): LocalStack | null {
  if (process.env.CI) {
    return null;
  }

  try {
    const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    });

    const status = JSON.parse(raw) as Record<string, string>;
    const supabaseUrl = status.API_URL;
    const publishableKey = status.PUBLISHABLE_KEY;
    const secretKey = status.SECRET_KEY;
    const mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL;

    if (!supabaseUrl || !publishableKey || !secretKey || !mailpitUrl) {
      return null;
    }

    return { supabaseUrl, publishableKey, secretKey, mailpitUrl };
  } catch {
    return null;
  }
}

const localStack = resolveLocalStack();

if (localStack) {
  // Read back by e2e/fixtures/localStack.ts inside the test process.
  process.env.E2E_SUPABASE_URL = localStack.supabaseUrl;
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY = localStack.publishableKey;
  process.env.E2E_SUPABASE_SECRET_KEY = localStack.secretKey;
  process.env.E2E_MAILPIT_URL = localStack.mailpitUrl;
}

// Without a live stack the Worker still needs some value here, or it fails its
// own health check and no test can run at all.
const publishableKey = localStack?.publishableKey ?? "e2e-placeholder";
const supabaseUrl = localStack?.supabaseUrl ?? "http://127.0.0.1:54321";

export default defineConfig({
  testDir: resolve(repoRoot, "e2e/tests"),
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev --workspace @upgradr/web -- --var APP_ORIGIN:http://127.0.0.1:8787 --var SUPABASE_URL:${supabaseUrl} --var SUPABASE_PUBLISHABLE_KEY:${publishableKey}`,
    cwd: repoRoot,
    url: "http://127.0.0.1:8787/api/health",
    // Safe to reuse a dev server the developer already has running: local
    // GoTrue does not validate the publishable key, so a server started with
    // the placeholder still authenticates (verified, not assumed).
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
