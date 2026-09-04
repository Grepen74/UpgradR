import { expect, test } from "@playwright/test";

import {
  createFixtureUser,
  deleteFixtureUser,
  readLocalStack,
  seedOpportunities,
  signIn,
} from "../fixtures/localStack";

// The trash control on a card is a *status transition*, not a delete, and the
// difference is invisible in the UI: the card disappears either way. What
// distinguishes them is what survives -- the row, and the suppression derived
// from it that stops an agent re-proposing the posting. Component tests can
// only assert the request that was sent; these assert the consequences.

const stack = readLocalStack();

test.describe("dismissing an opportunity from the board", () => {
  test.skip(
    stack === null,
    "Needs the local Supabase stack: run `supabase start`, then `npm run test:e2e:local`.",
  );

  test.setTimeout(60_000);

  let userId: string | null = null;
  let email = "";

  test.beforeEach(async ({ request }) => {
    if (!stack) return;
    email = `e2e-dismiss-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
    userId = await createFixtureUser(request, stack, email);
  });

  test.afterEach(async ({ request }) => {
    if (stack && userId) {
      await deleteFixtureUser(request, stack, userId);
      userId = null;
    }
  });

  const seeded = [
    { title: "Alpha Engineer", companyName: "Alpha AB" },
    { title: "Bravo Engineer", companyName: "Bravo AB" },
  ];

  test("takes the card off the board and keeps it under Closed", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seeded);

    const inbox = page.locator('section[aria-label^="Inbox"]');
    const cardTitles = inbox.locator("article.kanban-card button.kanban-card-open strong");
    await expect(cardTitles).toHaveText(["Alpha Engineer", "Bravo Engineer"]);

    await inbox.getByRole("button", { name: "Dismiss Alpha Engineer" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Dismiss" }).click();

    await expect(cardTitles).toHaveText(["Bravo Engineer"]);

    // A local state change would look identical up to here.
    await page.reload();
    await expect(cardTitles).toHaveText(["Bravo Engineer"]);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Closed opportunities/ }).click();
    await expect(page.getByText("Alpha Engineer").first()).toBeVisible();
  });

  test("cancelling leaves the board untouched", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seeded);

    const inbox = page.locator('section[aria-label^="Inbox"]');
    const cardTitles = inbox.locator("article.kanban-card button.kanban-card-open strong");

    await inbox.getByRole("button", { name: "Dismiss Alpha Engineer" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.reload();
    await expect(cardTitles).toHaveText(["Alpha Engineer", "Bravo Engineer"]);
  });

  test("records a suppression so an agent cannot re-propose the posting", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seeded);

    await page
      .locator('section[aria-label^="Inbox"]')
      .getByRole("button", { name: "Dismiss Alpha Engineer" })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Dismiss" }).click();
    // Scoped to the card title rather than the page: the live region announces
    // "Dismissed Alpha Engineer", so a bare text match never reaches zero.
    await expect(
      page.locator('section[aria-label^="Inbox"] article.kanban-card button.kanban-card-open strong'),
    ).toHaveText(["Bravo Engineer"]);

    // This is the property that makes dismissal the right operation. The rule
    // is written by an `after update` trigger, so it exists only because the
    // row was transitioned rather than deleted.
    const suppressions = await page.evaluate(async () => {
      const response = await fetch("/api/suppressions", { credentials: "include" });
      return (await response.json()) as { suppressions: { key_type: string; key_value: string }[] };
    });

    expect(
      suppressions.suppressions.some(
        (rule) => rule.key_type === "canonical_url" && rule.key_value.includes("board-ordering"),
      ),
    ).toBe(true);
  });

  test("the trash control opens the dialog rather than the opportunity", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seeded);

    await page
      .locator('section[aria-label^="Inbox"]')
      .getByRole("button", { name: "Dismiss Alpha Engineer" })
      .click();

    // The card is both a drag handle and a link into the detail view, so a
    // control living inside it can easily trigger both.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Opportunity detail" })).toHaveCount(0);
  });
});
