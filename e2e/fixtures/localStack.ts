import type { APIRequestContext, Page } from "@playwright/test";

// Helpers for tests that need a *real* local Supabase rather than the
// placeholder key the signed-out smoke test runs against. Everything here
// talks to 127.0.0.1 services started by `supabase start`; there is no hosted
// equivalent and these must never be pointed at a deployed project.

export type LocalStack = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  mailpitUrl: string;
};

/**
 * Reads the connection details `playwright.config.ts` resolved from
 * `supabase status`. Returns null when the local stack was not running, which
 * is the signal for authenticated specs to skip rather than fail.
 */
export function readLocalStack(): LocalStack | null {
  const supabaseUrl = process.env.E2E_SUPABASE_URL;
  const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY;
  const mailpitUrl = process.env.E2E_MAILPIT_URL;

  if (!supabaseUrl || !publishableKey || !secretKey || !mailpitUrl) {
    return null;
  }

  return { supabaseUrl, publishableKey, secretKey, mailpitUrl };
}

function adminHeaders(stack: LocalStack): Record<string, string> {
  return {
    apikey: stack.secretKey,
    Authorization: `Bearer ${stack.secretKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Creates a pre-confirmed fixture user. Confirming here means the sign-in flow
 * under test is the *returning user* magic link rather than a signup, and it
 * keeps the test independent of whether signups are currently enabled.
 *
 * Always use an @example.com address: local Supabase routes all outbound mail
 * to Mailpit including real external domains, so a realistic-looking address
 * would be indistinguishable from a live one if this ever ran elsewhere.
 */
export async function createFixtureUser(
  request: APIRequestContext,
  stack: LocalStack,
  email: string,
): Promise<string> {
  const response = await request.post(`${stack.supabaseUrl}/auth/v1/admin/users`, {
    headers: adminHeaders(stack),
    data: { email, email_confirm: true },
  });

  if (!response.ok()) {
    throw new Error(`Could not create fixture user: ${response.status()} ${await response.text()}`);
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) {
    throw new Error("Fixture user was created without an id");
  }
  return body.id;
}

/**
 * Deletes the fixture user. `applications` cascades from `auth.users`, so this
 * removes the seeded rows too and leaves the developer's local database as it
 * was found.
 */
export async function deleteFixtureUser(
  request: APIRequestContext,
  stack: LocalStack,
  userId: string,
): Promise<void> {
  await request.delete(`${stack.supabaseUrl}/auth/v1/admin/users/${userId}`, {
    headers: adminHeaders(stack),
  });
}

export type SeedOpportunity = {
  title: string;
  companyName: string;
};

/**
 * Creates opportunities through the app's own API as the signed-in user.
 *
 * Seeding straight into PostgREST with the secret key would be faster, but the
 * `service_role` has no `usage` grant on the `app` schema, so the triggers an
 * insert fires (`set_updated_at`, the match-assessment seeder, the generated
 * fingerprint column) fail with `permission denied for schema app`. That grant
 * is deliberate hardening and is not worth relaxing to make a test convenient.
 *
 * The request is issued from inside the page so it carries the session cookies
 * and an `Origin` the Worker accepts -- a direct API call is rejected with 403
 * by the CSRF origin check, which is that check working correctly.
 *
 * Opportunities are created in reverse: every new row has `board_position` 0,
 * so the list falls back to `updated_at desc` and the *last* one created sorts
 * first.
 */
export async function seedOpportunities(
  page: Page,
  opportunities: readonly SeedOpportunity[],
): Promise<void> {
  const payloads = [...opportunities].reverse().map((opportunity, index) => ({
    title: opportunity.title,
    companyName: opportunity.companyName,
    // A distinct URL per row keeps this clear of the canonical-URL duplicate
    // check, which would otherwise reject the second and third opportunity.
    sourceUrl: `https://example.com/jobs/board-ordering-${index}`,
    sourceProvider: "e2e-fixture",
  }));

  for (const payload of payloads) {
    const result = await page.evaluate(async (body) => {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      return { status: response.status, text: await response.text() };
    }, payload);

    if (result.status >= 400) {
      throw new Error(`Could not seed "${payload.title}": ${result.status} ${result.text}`);
    }
  }

  await page.reload();
}

type MailpitMessage = { ID: string; To: { Address: string }[] };

/**
 * Polls Mailpit for the newest message addressed to `email` and returns the
 * sign-in URL from it.
 *
 * The link has to be followed in the same browser context that requested it:
 * the magic link is PKCE, and `/api/auth/callback` can only exchange the code
 * using the verifier cookie the Worker set when the form was submitted.
 */
export async function waitForMagicLink(
  request: APIRequestContext,
  stack: LocalStack,
  email: string,
): Promise<string> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const listResponse = await request.get(`${stack.mailpitUrl}/api/v1/messages?limit=50`);
    if (listResponse.ok()) {
      const body = (await listResponse.json()) as { messages?: MailpitMessage[] };
      const message = body.messages?.find((candidate) =>
        candidate.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
      );

      if (message) {
        const source = await request.get(`${stack.mailpitUrl}/api/v1/message/${message.ID}`);
        const detail = (await source.json()) as { Text?: string; HTML?: string };
        const link = (detail.Text ?? "")
          .concat(" ", detail.HTML ?? "")
          .match(/https?:\/\/[^\s"'<>]*verify[^\s"'<>]*/)?.[0];

        if (link) {
          return link.replaceAll("&amp;", "&");
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No magic link arrived for ${email} within 15s`);
}

/**
 * Signs in through the real form so the Worker issues its own session cookies.
 *
 * `POST /api/auth/magic-link` rejects requests whose Origin is not the app
 * origin, so this cannot be shortcut with a direct API call -- which is the
 * CSRF protection behaving correctly.
 */
export async function signIn(page: Page, stack: LocalStack, email: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);

  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes("/api/auth/magic-link")),
    page.locator("form.sign-in-card button").click(),
  ]);

  // A failure here is almost always configuration rather than a product bug,
  // and the alternative is a 15-second wait for a magic link that was never
  // sent, so surface the status immediately.
  //
  // Note that local GoTrue does *not* validate the publishable key, so a web
  // server started with the placeholder key still signs users in successfully;
  // this is measured, not assumed. That is why the config can safely reuse an
  // already-running dev server.
  if (!response.ok()) {
    throw new Error(
      `Sign-in request failed with ${response.status()}. Check that the local Supabase ` +
        `stack is running (\`supabase start\`) and that the web server was started with ` +
        `APP_ORIGIN matching the address the test is using.`,
    );
  }

  const link = await waitForMagicLink(page.request, stack, email);
  await page.goto(link);
  await page.waitForURL((url) => !url.pathname.startsWith("/api/"));
}
