import { expect, test } from "@playwright/test";

import { createFixtureUser, deleteFixtureUser, readLocalStack, signIn } from "../fixtures/localStack";

// Browser coverage for "Populate from PDF".
//
// The component tests for this run in jsdom, which cannot exercise the parts
// most likely to break: the lazily imported pdf.js chunk has to actually load
// over the network, `FileReader` has to be the real one, and the file input has
// to receive a real file. This repository has twice shipped a feature whose
// jsdom tests all passed and whose browser behaviour was broken, so the flow is
// driven here end to end and asserted after a reload -- rendering the extracted
// text proves nothing about whether it was saved.

/**
 * Opens the Profile page. Needed after every reload: the dashboard tab is
 * component state rather than part of the URL, so a reload always lands back on
 * Overview.
 */
async function openProfile(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Account settings menu" }).click();
  await page.getByRole("menuitem", { name: "Profile", exact: true }).click();
}

const stack = readLocalStack();

test.describe("populate relevant experience from a PDF", () => {
  test.skip(
    stack === null,
    "Needs the local Supabase stack: run `supabase start`, then re-run Playwright.",
  );

  test.setTimeout(60_000);

  let userId: string | null = null;
  let email = "";

  test.beforeEach(async ({ request }) => {
    if (!stack) return;
    email = `e2e-cv-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
    userId = await createFixtureUser(request, stack, email);
  });

  test.afterEach(async ({ request }) => {
    if (stack && userId) {
      await deleteFixtureUser(request, stack, userId);
      userId = null;
    }
  });

  test("extracts a CV in the browser, redacts it, and saves only after review", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);

    await openProfile(page);

    const field = page.getByLabel("Relevant experience");
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("");

    // The PDF must never be uploaded, so any request carrying it is a failure of
    // the central privacy property rather than a detail. Watching the network is
    // the only way to assert an absence like this.
    const uploads: string[] = [];
    page.on("request", (request) => {
      const type = request.headers()["content-type"] ?? "";
      if (type.includes("multipart/form-data") || type.includes("application/pdf")) {
        uploads.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.setInputFiles(
      'input[type="file"][accept*="pdf"]',
      "../apps/web/src/__fixtures__/resume.pdf",
    );

    // Extraction happens after the pdf.js chunk downloads, so this is the first
    // assertion that the lazy import actually resolves in a browser.
    await expect(field).toHaveValue(/Senior iOS Engineer/, { timeout: 30_000 });
    await expect(field).toHaveValue(/Swift Concurrency/);

    const populated = await field.inputValue();
    expect(populated).not.toContain("jane.lindqvist@example.com");
    expect(populated).not.toContain("+46 70 123 45 67");
    expect(populated).not.toContain("Storgatan 4");

    // Populating must not have written anything yet.
    await page.reload();
    await openProfile(page);
    await expect(page.getByLabel("Relevant experience")).toHaveValue("");

    await page.setInputFiles(
      'input[type="file"][accept*="pdf"]',
      "../apps/web/src/__fixtures__/resume.pdf",
    );
    await expect(page.getByLabel("Relevant experience")).toHaveValue(/Senior iOS Engineer/, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await openProfile(page);
    const saved = await page.getByLabel("Relevant experience").inputValue();
    expect(saved).toContain("Senior iOS Engineer");
    expect(saved).not.toContain("jane.lindqvist@example.com");

    expect(uploads).toEqual([]);
  });

  test("keeps the structured editors available but collapsed", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await openProfile(page);

    // Demoted, not deleted: the LinkedIn CSV import writes into these tables and
    // they carry the only structured dates, so they have to remain reachable.
    const disclosure = page.getByText("Add structured details (optional)");
    await expect(disclosure).toBeVisible();
    await expect(page.getByRole("button", { name: "Add role" })).toBeHidden();

    await disclosure.click();
    await expect(page.getByRole("button", { name: "Add role" })).toBeVisible();
  });
});
