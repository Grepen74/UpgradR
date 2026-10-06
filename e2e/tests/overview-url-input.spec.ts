import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createFixtureUser,
  deleteFixtureUser,
  readLocalStack,
  seedOpportunities,
  signInWithGeneratedLink,
} from "../fixtures/localStack";

const stack = readLocalStack();

async function dragWithPointer(page: Page, sourceElement: Locator, targetElement: Locator) {
  const source = await sourceElement.boundingBox();
  const target = await targetElement.boundingBox();
  if (!source || !target) throw new Error("Drag targets are not visible");
  await page.mouse.move(source.x + 8, source.y + 8);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  // A second move ensures native dragover fires after dragenter.
  await page.mouse.move(target.x + target.width / 2 + 1, target.y + target.height / 2);
  await page.mouse.up();
}

test("Overview handles real browser drop/paste events and explicit Save with a mocked API", async ({ page }) => {
  const applications: {
    id: string; title: string; company_name: string; source_url: string; source_provider: string;
    current_status: string; location: string | null; closing_date: null; match_score: null;
    confidence: null; mcp_client_id: null; board_position: number; created_at: string; updated_at: string;
    labels: never[];
  }[] = [];
  const writes: { sourceUrl: string; sourceProvider: string }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown;
    if (path === "/api/session") {
      body = { user: { id: "fixture-user", email: "fixture@example.com" } };
    } else if (path === "/api/dashboard") {
      body = { proposals: 0, active: applications.length, overdue: 0 };
    } else if (path === "/api/tasks") {
      body = { tasks: [] };
    } else if (path === "/api/applications" && request.method() === "POST") {
      const input = request.postDataJSON() as {
        title: string; companyName: string; sourceUrl: string; sourceProvider: string;
      };
      writes.push(input);
      applications.push({
        id: "fixture-application", title: input.title, company_name: input.companyName,
        source_url: input.sourceUrl, source_provider: input.sourceProvider, current_status: "saved",
        location: null, closing_date: null, match_score: null, confidence: null, mcp_client_id: null,
        board_position: 0, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", labels: [],
      });
      body = { id: "fixture-application" };
    } else if (path === "/api/applications") {
      body = { applications };
    } else {
      throw new Error(`Unexpected browser fixture request: ${request.method()} ${path}`);
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.getByText("No opportunities yet")).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("text/uri-list", "# Browser tab\nhttps://example.com/job?source=tab#apply");
    data.setData("text/plain", "A browser tab title");
    return data;
  });
  await page.getByText("No opportunities yet").dispatchEvent("dragover", { dataTransfer });
  await expect(page.getByText("Drop one job posting URL to prefill Add opportunity")).toBeVisible();
  await page.getByText("No opportunities yet").dispatchEvent("drop", { dataTransfer });
  await expect(page.getByLabel("Job posting URL")).toHaveValue("https://example.com/job?source=tab#apply");
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
  await page.getByLabel("Role", { exact: true }).fill("Browser Engineer");
  await page.getByLabel("Company", { exact: true }).fill("Example");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "www.example.com/jobs/paste");
    document.body.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: data, bubbles: true, cancelable: true,
    }));
  });
  await expect(page.getByLabel("Job posting URL")).toHaveValue("https://www.example.com/jobs/paste");
  await expect(page.getByLabel("Role", { exact: true })).toHaveValue("Browser Engineer");
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue("Example");
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save opportunity" }).click();
  await expect(page.getByRole("button", { name: "Add opportunity" })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    sourceUrl: "https://www.example.com/jobs/paste", sourceProvider: "www.example.com",
  });
  await expect(page.getByRole("button", { name: /^Browser Engineer\s*Example/ })).toBeVisible();
  const column = page.locator('section[aria-label^="Shortlist"]');
  await column.dispatchEvent("dragover", { dataTransfer });
  await expect(page.locator(".kanban-drop-indicator")).toHaveCount(0);
  await column.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByLabel("Job posting URL")).toHaveValue("https://example.com/job?source=tab#apply");
  expect(writes).toHaveLength(1);
  await dataTransfer.dispose();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Browser Engineer\s*Example/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add opportunity" })).toBeVisible();
});

test.describe("Overview URL input", () => {
  test.skip(stack === null, "Needs the local Supabase stack: run `supabase start`.");
  test.setTimeout(60_000);

  let userId: string | null = null;
  let email = "";

  test.beforeEach(async ({ request }) => {
    if (!stack) return;
    email = `e2e-url-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
    userId = await createFixtureUser(request, stack, email);
  });

  test.afterEach(async ({ request }) => {
    if (stack && userId) {
      await deleteFixtureUser(request, stack, userId);
      userId = null;
    }
  });

  test("drops a browser URL on an empty Overview and saves only after review", async ({ page }) => {
    if (!stack) return;
    await signInWithGeneratedLink(page, stack, email);
    await expect(page.getByText("No opportunities yet")).toBeVisible();
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/applications")) {
        writes.push(request.postData() ?? "");
      }
    });

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData("text/uri-list", "# Browser tab\nhttps://example.com/jobs/drop?ref=tab#apply");
      data.setData("text/plain", "https://example.com/jobs/drop?ref=tab#apply");
      return data;
    });
    await page.getByText("No opportunities yet").dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(page.getByText("Drop one job posting URL to prefill Add opportunity")).toBeVisible();
    await page.getByText("No opportunities yet").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByLabel("Job posting URL")).toHaveValue("https://example.com/jobs/drop?ref=tab#apply");
    await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
    expect(writes).toHaveLength(0);

    await page.getByLabel("Role", { exact: true }).fill("Dropped Engineer");
    await page.getByLabel("Company", { exact: true }).fill("Example");
    await page.getByRole("button", { name: "Save opportunity" }).click();
    await expect(page.getByRole("button", { name: "Add opportunity" })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      sourceUrl: "https://example.com/jobs/drop?ref=tab#apply", sourceProvider: "example.com",
    });
    await page.reload();
    await expect(page.getByRole("button", { name: /^Dropped Engineer\s*Example/ })).toBeVisible();
    const applications = await page.evaluate(async () => {
      const response = await fetch("/api/applications");
      if (!response.ok) throw new Error(`Application list failed: ${response.status}`);
      return response.json() as Promise<{ applications: { source_url: string }[] }>;
    });
    expect(applications.applications[0]?.source_url).toBe("https://example.com/jobs/drop?ref=tab#apply");
    await transfer.dispose();
  });

  test("drops on populated columns without moving cards and preserves drafts on paste", async ({ page }) => {
    if (!stack) return;
    await signInWithGeneratedLink(page, stack, email);
    await seedOpportunities(page, [{ title: "Existing Engineer", companyName: "Acme" }]);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/applications")) writes.push(request.url());
    });

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "www.example.com/jobs/new");
      return data;
    });
    const shortlist = page.locator('section[aria-label^="Shortlist"]');
    await shortlist.dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(page.locator(".kanban-drop-indicator")).toHaveCount(0);
    await shortlist.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByLabel("Job posting URL")).toHaveValue("https://www.example.com/jobs/new");
    await expect(page.locator('section[aria-label^="Inbox"]').getByText("Existing Engineer")).toBeVisible();
    await page.getByLabel("Role", { exact: true }).fill("Draft Role");
    await page.getByLabel("Company", { exact: true }).fill("Draft Company");

    // Native event payload coverage; physical pasteboard shortcuts and browser
    // chrome drags still need cross-browser manual verification.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/jobs/pasted");
      document.body.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: data, bubbles: true, cancelable: true,
      }));
    });
    await expect(page.getByLabel("Job posting URL")).toHaveValue("https://example.com/jobs/pasted");
    await expect(page.getByLabel("Role", { exact: true })).toHaveValue("Draft Role");
    await expect(page.getByLabel("Company", { exact: true })).toHaveValue("Draft Company");
    expect(writes).toHaveLength(0);

    const fieldPasteWasIntercepted = await page.getByLabel("Company", { exact: true }).evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/ordinary-paste");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(fieldPasteWasIntercepted).toBe(false);
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    const otherTabPasteWasIntercepted = await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "https://example.com/jobs/other");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(otherTabPasteWasIntercepted).toBe(false);
    await transfer.dispose();
  });

  test("keeps native card drags working and persists the move", async ({ page, isMobile }) => {
    test.skip(isMobile, "Native pointer dragging is a desktop interaction.");
    if (!stack) return;
    await signInWithGeneratedLink(page, stack, email);
    await seedOpportunities(page, [{ title: "Dragged Engineer", companyName: "Acme" }]);
    const inbox = page.locator('section[aria-label^="Inbox"]');
    const shortlist = page.locator('section[aria-label^="Shortlist"]');
    await page.locator(".kanban-board").scrollIntoViewIfNeeded();
    await dragWithPointer(page, inbox.locator("article.kanban-card"), shortlist);
    await expect(shortlist.getByText("Dragged Engineer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add opportunity" })).toBeVisible();
    await expect(page.getByLabel("Job posting URL")).toHaveCount(0);
    await page.reload();
    await expect(shortlist.getByText("Dragged Engineer")).toBeVisible();
  });

  test("prefills from a native browser link drag without navigating or creating a row", async ({ page, isMobile }) => {
    test.skip(isMobile, "Native pointer dragging is a desktop interaction.");
    if (!stack) return;
    await signInWithGeneratedLink(page, stack, email);
    await seedOpportunities(page, [{ title: "Existing Engineer", companyName: "Acme" }]);
    const overviewUrl = page.url();
    await expect(page.getByRole("button", { name: "Add opportunity" })).toBeVisible();
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/applications")) writes.push(request.url());
    });
    await page.evaluate(() => {
      const heading = document.querySelector(".panel-heading");
      if (!heading) throw new Error("Overview heading is missing");
      const link = document.createElement("a");
      link.href = "https://example.com/jobs/native?source=browser#apply";
      link.textContent = "Browser job link";
      link.className = "button secondary";
      heading.append(link);
    });
    await page.locator(".kanban-board").scrollIntoViewIfNeeded();
    await dragWithPointer(page, page.getByRole("link", { name: "Browser job link" }),
      page.locator('section[aria-label^="Shortlist"]'));
    await expect(page.getByLabel("Job posting URL")).toHaveValue("https://example.com/jobs/native?source=browser#apply");
    await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
    await expect(page).toHaveURL(overviewUrl);
    expect(writes).toHaveLength(0);
    await expect(page.locator('section[aria-label^="Inbox"]').getByText("Existing Engineer")).toBeVisible();
  });
});
