import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpportunityDetail } from "./OpportunityDetail";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : (input as Request).url ?? String(input);
}

const baseApplication = {
  id: "app-1",
  company_id: null,
  primary_contact_id: null,
  title: "Senior Engineer",
  company_name: "Acme",
  location: "Remote",
  source_url: "https://acme.example/jobs/1",
  source_provider: "acme.example",
  external_id: null,
  description: null,
  compensation_min: null,
  compensation_max: null,
  compensation_currency: null,
  match_score: 82,
  match_rationale: "Strong fit on backend experience.",
  strengths: ["TypeScript"],
  gaps: ["Kubernetes"],
  confidence: 0.7,
  current_status: "applied" as const,
  mcp_client_id: null,
  applied_at: null,
  archived_at: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  labels: [{ id: "label-1", name: "Dream job", color: null, created_at: "", updated_at: "" }],
};

function mockDetailFetch(
  overrides: { labels?: unknown[]; posts?: (url: string, body: string) => void } = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (method === "POST" || method === "DELETE") {
      overrides.posts?.(url, String(init?.body ?? ""));
    }

    if (url.includes("/api/applications/app-1/labels") && method === "POST") {
      return jsonResponse({ label: { id: "label-2", name: "New label", color: null } }, { status: 201 });
    }
    if (url.includes("/api/applications/app-1/labels") && method === "DELETE") {
      return jsonResponse({ detached: true });
    }
    if (url.includes("/api/applications/app-1") && method === "GET") {
      return jsonResponse({ application: baseApplication, statusEvents: [], matchAssessments: [] });
    }
    if (url.includes("/api/tasks") && method === "POST") {
      return jsonResponse({ task: { id: "task-new" } }, { status: 201 });
    }
    if (url.includes("/api/tasks")) {
      return jsonResponse({ tasks: [] });
    }
    if (url.includes("/api/notes")) {
      return jsonResponse({ notes: [] });
    }
    if (url.includes("/api/documents")) {
      return jsonResponse({ documents: [], quota: { usedBytes: 0, maxBytes: 1, count: 0, maxCount: 1 } });
    }
    if (url.includes("/api/companies")) {
      return jsonResponse({ companies: [] });
    }
    if (url.includes("/api/contacts")) {
      return jsonResponse({ contacts: [] });
    }
    if (url.includes("/api/activity")) {
      return jsonResponse({ events: [] });
    }
    if (url.includes("/api/labels") && method === "POST") {
      return jsonResponse({ label: { id: "label-3", name: "Created", color: null } }, { status: 201 });
    }
    if (url.includes("/api/labels")) {
      return jsonResponse({ labels: overrides.labels ?? [] });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

describe("OpportunityDetail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders overview, match assessment, status, and label sections", async () => {
    mockDetailFetch();

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });
    expect(screen.getByText(/82% match/)).toBeVisible();
    expect(screen.getByText("Strong fit on backend experience.")).toBeVisible();
    expect(screen.getByText("Dream job")).toBeVisible();
    expect(screen.getByText("applied")).toBeVisible();
  });

  it("calls onClose when 'Back to board' is activated", async () => {
    mockDetailFetch();
    const onClose = vi.fn();

    render(<OpportunityDetail applicationId="app-1" onClose={onClose} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /close opportunity detail/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus into the modal when it opens", async () => {
    mockDetailFetch();

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    const closeButton = await screen.findByRole("button", {
      name: /close opportunity detail/i,
    });
    expect(closeButton).toHaveFocus();
  });

  it("attaches an existing label from the select control", async () => {
    const posts: { url: string; body: string }[] = [];
    mockDetailFetch({
      labels: [{ id: "label-9", name: "Remote friendly", color: null, created_at: "", updated_at: "" }],
      posts: (url, body) => posts.push({ url, body }),
    });
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={onChanged} />);

    const select = await screen.findByLabelText("Attach an existing label");
    fireEvent.change(select, { target: { value: "label-9" } });

    await waitFor(() => {
      expect(posts.some((entry) => entry.url.includes("/labels"))).toBe(true);
    });
    const attach = posts.find((entry) => entry.url.endsWith("/app-1/labels"));
    expect(attach?.body).toBe(JSON.stringify({ labelId: "label-9" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("removes an attached label", async () => {
    const posts: { url: string; body: string }[] = [];
    mockDetailFetch({ posts: (url, body) => posts.push({ url, body }) });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /remove label dream job/i }));

    await waitFor(() => {
      expect(posts.some((entry) => entry.url.includes("/labels/label-1"))).toBe(true);
    });
  });

  it("adds a follow-up task scoped to this opportunity", async () => {
    const posts: { url: string; body: string }[] = [];
    mockDetailFetch({ posts: (url, body) => posts.push({ url, body }) });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Send thank-you note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));

    await waitFor(() => {
      expect(posts.some((entry) => entry.url.includes("/api/tasks"))).toBe(true);
    });
    const taskPost = posts.find((entry) => entry.url.includes("/api/tasks"));
    expect(JSON.parse(taskPost?.body ?? "{}")).toMatchObject({
      title: "Send thank-you note",
      applicationId: "app-1",
    });
  });
});
