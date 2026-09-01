import { expect, test } from "@playwright/test";

test("renders the signed-out landing page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: /turn scattered opportunities into a focused next move/i,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

