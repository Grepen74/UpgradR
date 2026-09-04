import { expect, test } from "@playwright/test";

import {
  createFixtureUser,
  deleteFixtureUser,
  readLocalStack,
  seedOpportunities,
  signIn,
} from "../fixtures/localStack";

// Regression coverage for a bug that 30 passing component tests could not see.
//
// Keyboard reordering was broken in one direction only: `moveCard` takes a drop
// *gap* (an index in the list as rendered, which still contains the card being
// moved) while `moveByKeyboard` was passing a final destination index. Those
// agree when moving up and differ by one when moving down, so a downward move
// computed an unchanged order and was swallowed by the no-op guard -- no
// request, no error, no announcement. Every unit test pressed ArrowUp, the one
// direction where the bug is invisible.
//
// Unit tests now cover the conversion directly. This exercises the same path
// against the real Worker, RLS, and database, because the failure was that
// nothing reached the server at all.

const stack = readLocalStack();

test.describe("board ordering", () => {
  test.skip(
    stack === null,
    "Needs the local Supabase stack: run `supabase start`, then `npm run test:e2e:local`.",
  );

  // The magic-link round trip through Mailpit is slower than a normal spec.
  test.setTimeout(60_000);

  let userId: string | null = null;
  let email = "";

  test.beforeEach(async ({ request }) => {
    if (!stack) return;

    // A fresh user per test keeps the board deterministic without touching
    // rows the developer may already have in their local database.
    email = `e2e-board-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
    userId = await createFixtureUser(request, stack, email);
  });

  test.afterEach(async ({ request }) => {
    if (stack && userId) {
      await deleteFixtureUser(request, stack, userId);
      userId = null;
    }
  });

  const seedInbox = [
    { title: "Alpha Engineer", companyName: "Alpha AB" },
    { title: "Bravo Engineer", companyName: "Bravo AB" },
    { title: "Charlie Engineer", companyName: "Charlie AB" },
  ];

  test("moves a card down with the keyboard and persists the new order", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seedInbox);

    const inbox = page.locator('section[aria-label^="Inbox"]');
    const cardTitles = inbox.locator("article.kanban-card button.kanban-card-open strong");

    await expect(cardTitles).toHaveText([
      "Alpha Engineer",
      "Bravo Engineer",
      "Charlie Engineer",
    ]);

    await inbox.getByRole("button", { name: /^Reorder Alpha Engineer/ }).press("ArrowDown");

    await expect(cardTitles).toHaveText([
      "Bravo Engineer",
      "Alpha Engineer",
      "Charlie Engineer",
    ]);

    // Asserting only the rendered order would pass on a purely local state
    // change, which is the half of the feature that already worked. The reload
    // is what proves the move reached the database.
    await page.reload();

    await expect(cardTitles).toHaveText([
      "Bravo Engineer",
      "Alpha Engineer",
      "Charlie Engineer",
    ]);
  });

  test("moves a card up with the keyboard and persists the new order", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seedInbox);

    const inbox = page.locator('section[aria-label^="Inbox"]');
    const cardTitles = inbox.locator("article.kanban-card button.kanban-card-open strong");

    await inbox.getByRole("button", { name: /^Reorder Charlie Engineer/ }).press("ArrowUp");

    await expect(cardTitles).toHaveText([
      "Alpha Engineer",
      "Charlie Engineer",
      "Bravo Engineer",
    ]);

    await page.reload();

    await expect(cardTitles).toHaveText([
      "Alpha Engineer",
      "Charlie Engineer",
      "Bravo Engineer",
    ]);
  });

  test("moves a card to another column with the keyboard", async ({ page }) => {
    if (!stack) return;

    await signIn(page, stack, email);
    await seedOpportunities(page, seedInbox);

    const inbox = page.locator('section[aria-label^="Inbox"]');
    const shortlist = page.locator('section[aria-label^="Shortlist"]');
    const cardTitle = "article.kanban-card button.kanban-card-open strong";

    await inbox.getByRole("button", { name: /^Reorder Alpha Engineer/ }).press("ArrowRight");

    await expect(shortlist.locator(cardTitle)).toHaveText(["Alpha Engineer"]);
    await expect(inbox.locator(cardTitle)).toHaveText([
      "Bravo Engineer",
      "Charlie Engineer",
    ]);

    await page.reload();

    // A cross-column move is a status transition as well as a reorder, so the
    // card has to still be in Shortlist after a round trip rather than
    // reverting to its seeded status.
    await expect(shortlist.locator(cardTitle)).toHaveText(["Alpha Engineer"]);
  });
});
