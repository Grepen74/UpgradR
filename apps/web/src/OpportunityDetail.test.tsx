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
  overrides: {
    labels?: unknown[];
    posts?: (url: string, body: string) => void;
    matchAssessments?: unknown[];
    suppressions?: unknown[];
    application?: Record<string, unknown>;
  } = {},
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
      return jsonResponse({
        application: { ...baseApplication, ...(overrides.application ?? {}) },
        statusEvents: [],
        matchAssessments: overrides.matchAssessments ?? [],
      });
    }
    if (url.includes("/api/applications/app-1/status") && method === "POST") {
      return jsonResponse({ application: baseApplication });
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
    if (url.includes("/api/suppressions") && method === "POST") {
      return jsonResponse({ suppression: { id: "sup-new" } }, { status: 201 });
    }
    if (url.includes("/api/suppressions") && method === "DELETE") {
      return jsonResponse({ deleted: true });
    }
    if (url.includes("/api/suppressions")) {
      return jsonResponse({ suppressions: overrides.suppressions ?? [] });
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

  it("explains that the score is the agent's estimate, not an UpgradR calculation", async () => {
    mockDetailFetch();

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/82% match/)).toBeVisible();
    });

    // Confidence is about the extracted facts, not about the match; labelling
    // it as a bare percentage next to the score implied they were comparable.
    expect(screen.getByText(/70% confidence in the extracted facts/)).toBeVisible();

    const explainer = screen.getByText("What do these numbers mean?");
    expect(explainer).toBeVisible();
    fireEvent.click(explainer);

    expect(
      screen.getByText(/UpgradR does not calculate it and does not verify it/),
    ).toBeVisible();
  });

  it("attributes a score to the agent that produced it", async () => {
    mockDetailFetch({
      matchAssessments: [
        {
          id: "assessment-1",
          score: 82,
          rationale: null,
          strengths: [],
          gaps: [],
          confidence: 0.7,
          assessed_by: "agent",
          mcp_client_id: "copilot-cli",
          created_at: "2026-09-01T10:00:00+00:00",
        },
      ],
    });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Scored by copilot-cli/)).toBeVisible();
    });
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

  it("requires choosing an outcome before closing, then posts the chosen outcome", async () => {
    const posts: { url: string; body: string }[] = [];
    mockDetailFetch({ posts: (url, body) => posts.push({ url, body }) });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });

    const closeButton = screen.getByRole("button", { name: "Close opportunity" });
    expect(closeButton).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "rejected" }));
    expect(closeButton).toBeEnabled();

    fireEvent.click(closeButton);
    fireEvent.click(screen.getByRole("button", { name: /confirm close as rejected/i }));

    await waitFor(() => {
      expect(posts.some((entry) => entry.url.endsWith("/app-1/status"))).toBe(true);
    });
    const statusPost = posts.find((entry) => entry.url.endsWith("/app-1/status"));
    expect(JSON.parse(statusPost?.body ?? "{}")).toMatchObject({ status: "rejected" });
  });

  it("does not offer a close control for an already-closed opportunity, and offers reopen instead", async () => {
    mockDetailFetch();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/applications/app-1") && method === "GET") {
        return jsonResponse({
          application: { ...baseApplication, current_status: "rejected" },
          statusEvents: [],
          matchAssessments: [],
        });
      }
      if (url.includes("/api/tasks")) return jsonResponse({ tasks: [] });
      if (url.includes("/api/notes")) return jsonResponse({ notes: [] });
      if (url.includes("/api/documents")) {
        return jsonResponse({ documents: [], quota: { usedBytes: 0, maxBytes: 1, count: 0, maxCount: 1 } });
      }
      if (url.includes("/api/companies")) return jsonResponse({ companies: [] });
      if (url.includes("/api/contacts")) return jsonResponse({ contacts: [] });
      if (url.includes("/api/activity")) return jsonResponse({ events: [] });
      if (url.includes("/api/labels")) return jsonResponse({ labels: [] });
      if (url.includes("/api/suppressions")) return jsonResponse({ suppressions: [] });
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });

    expect(screen.queryByRole("button", { name: "Close opportunity" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen opportunity" })).toBeDisabled();
  });

  it("reopens a closed opportunity into the chosen active stage", async () => {
    const posts: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST") posts.push({ url, body: String(init?.body ?? "") });
      if (url.includes("/api/applications/app-1") && method === "GET") {
        return jsonResponse({
          application: { ...baseApplication, current_status: "rejected" },
          statusEvents: [],
          matchAssessments: [],
        });
      }
      if (url.includes("/api/applications/app-1/status") && method === "POST") {
        return jsonResponse({ application: { ...baseApplication, current_status: "shortlisted" } });
      }
      if (url.includes("/api/tasks")) return jsonResponse({ tasks: [] });
      if (url.includes("/api/notes")) return jsonResponse({ notes: [] });
      if (url.includes("/api/documents")) {
        return jsonResponse({ documents: [], quota: { usedBytes: 0, maxBytes: 1, count: 0, maxCount: 1 } });
      }
      if (url.includes("/api/companies")) return jsonResponse({ companies: [] });
      if (url.includes("/api/contacts")) return jsonResponse({ contacts: [] });
      if (url.includes("/api/activity")) return jsonResponse({ events: [] });
      if (url.includes("/api/labels")) return jsonResponse({ labels: [] });
      if (url.includes("/api/suppressions")) return jsonResponse({ suppressions: [] });
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText("Reopen into an active stage"), {
      target: { value: "shortlisted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reopen opportunity" }));

    await waitFor(() => {
      expect(posts.some((entry) => entry.url.endsWith("/app-1/status"))).toBe(true);
    });
    const statusPost = posts.find((entry) => entry.url.endsWith("/app-1/status"));
    expect(JSON.parse(statusPost?.body ?? "{}")).toMatchObject({ status: "shortlisted" });
  });

  it("offers to mute the company, and sends the name unnormalized", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    mockDetailFetch({ posts: (url, body) => posts.push({ url, body }) });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mute Acme" })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Mute Acme" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm mute Acme" }));

    await waitFor(() => {
      const call = posts.find((entry) => entry.url.includes("/api/suppressions"));
      expect(call).toBeDefined();
      // The server normalizes; sending a pre-normalized token from here would
      // mean two places had to agree on the algorithm.
      expect(JSON.parse(call!.body)).toMatchObject({ keyType: "company", keyValue: "Acme" });
    });
  });

  it("matches an existing rule through the same normalization the database uses", async () => {
    // "Acme" tokenizes to "acme", which is what a rule created from "Acme, Inc."
    // would not match -- but a rule stored as "acme" must, or the user would be
    // offered a mute they already have.
    mockDetailFetch({
      suppressions: [
        {
          id: "sup-1",
          key_type: "company",
          key_value: "acme",
          reason: null,
          source: "manual",
          expires_at: "2027-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unmute Acme" })).toBeVisible();
    });
    expect(screen.queryByRole("button", { name: "Mute Acme" })).toBeNull();
  });

  it("hides the mute control when the opportunity names no company", async () => {
    // A company rule keyed on an empty string would match every unnamed
    // opportunity the user ever adds, so there is nothing coherent to offer.
    mockDetailFetch({ application: { company_name: "  " } });

    render(<OpportunityDetail applicationId="app-1" onClose={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Senior Engineer" })).toBeVisible();
    });
    expect(screen.queryByRole("button", { name: /^Mute/ })).toBeNull();
  });
});
