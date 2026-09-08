#!/usr/bin/env node
/**
 * Mints a fresh, one-click sign-in link for the demo/showcase account and
 * (by default) opens it directly in your browser -- no email round-trip,
 * repeatable on demand.
 *
 * Usage:
 *   npm run demo:login
 *   npm run demo:login -- --email demo@upgradr.app
 *   npm run demo:login -- --no-open
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY exported in this terminal. Requires the
 * demo account to already exist -- run `npm run demo:reset` first if it
 * doesn't.
 */
import { execFile } from "node:child_process";

import {
  createServiceClient,
  DEFAULT_DEMO_EMAIL,
  findUserIdByEmail,
  PROD_APP_ORIGIN,
  PROD_SUPABASE_URL,
  requireServiceRoleKey,
} from "./lib/demo-account.mjs";

function parseArgs(argv) {
  const args = { email: DEFAULT_DEMO_EMAIL, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") args.email = argv[++i];
    else if (arg === "--no-open") args.open = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function openInBrowser(url) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(opener, [url], (error) => {
    if (error) {
      console.error(`Could not auto-open a browser (${error.message}). Open the URL above manually.`);
    }
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`
Mint a fresh sign-in link for the demo account, no email required.

  --email <address>   Demo account to sign in as. Default: ${DEFAULT_DEMO_EMAIL}
  --no-open            Print the link instead of opening it automatically.

Requires SUPABASE_SERVICE_ROLE_KEY in this terminal, and the demo account to
already exist (npm run demo:reset).
`);
  process.exit(0);
}

let serviceRoleKey;
try {
  serviceRoleKey = requireServiceRoleKey();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const serviceClient = createServiceClient({ supabaseUrl: PROD_SUPABASE_URL, serviceRoleKey });

const existingId = await findUserIdByEmail(serviceClient, args.email);
if (!existingId) {
  console.error(
    `\nNo demo account found for ${args.email}. Run "npm run demo:reset" first to create and seed it.\n`,
  );
  process.exit(1);
}

const { data, error } = await serviceClient.auth.admin.generateLink({
  type: "magiclink",
  email: args.email,
  options: { redirectTo: `${PROD_APP_ORIGIN}/api/auth/callback` },
});
if (error || !data?.properties?.hashed_token) {
  console.error(`\nCould not generate a sign-in link: ${error?.message ?? "no token returned"}\n`);
  process.exit(1);
}

// Deliberately not GoTrue's own data.properties.action_link: that link
// exchanges a PKCE code via /api/auth/callback, which requires a
// code_verifier cookie the Worker only sets while handling a same-browser
// /api/auth/magic-link POST -- one never happened here, so it silently fails
// and the browser just keeps showing whichever session already existed in
// its cookie jar. /api/auth/verify redeems the token_hash directly via
// verifyOtp(), which has no such requirement. See apps/web/worker/index.ts.
const link = `${PROD_APP_ORIGIN}/api/auth/verify?token_hash=${encodeURIComponent(data.properties.hashed_token)}`;
console.log(`\nSigned in as: ${args.email}\nSign-in link (single-use, expires soon): ${link}\n`);

if (args.open) {
  console.log("Opening in your default browser...");
  openInBrowser(link);
} else {
  console.log("Open the link above to sign in.");
}
