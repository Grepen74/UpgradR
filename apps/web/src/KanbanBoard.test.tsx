import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummary } from "./api";
import { KanbanBoard } from "./KanbanBoard";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : (input as Request).url ?? String(input);
}

function makeApplication(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: "app-1",
    title: "Senior Engineer",
    company_name: "Acme",
    location: "Remote",
    source_url: "https://acme.example/jobs/1",
    source_provider: "acme.example",
    current_status: "saved",
    match_score: 82,
    confidence: null,
    mcp_client_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

describe("KanbanBoard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("groups opportunities into their Kanban column by detailed status, and never shows a Closed column", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const applications = [
      makeApplication({ id: "app-1", title: "Inbox Role", current_status: "saved" }),
      makeApplication({ id: "app-2", title: "Offer Role", current_status: "offer" }),
    ];

    render(
      <KanbanBoard applications={applications} onRefresh={vi.fn()} onOpenApplication={vi.fn()} />,
    );

    const inboxColumn = screen.getByRole("region", { name: /inbox/i });
    expect(within(inboxColumn).getByText("Inbox Role")).toBeVisible();

    const offerColumn = screen.getByRole("region", { name: /offer/i });
    expect(within(offerColumn).getByText("Offer Role")).toBeVisible();

    expect(screen.queryByRole("region", { name: /closed/i })).not.toBeInTheDocument();
  });

  it("excludes closed opportunities even if one is passed in by the caller", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const applications = [
      makeApplication({ id: "app-1", title: "Inbox Role", current_status: "saved" }),
      makeApplication({ id: "app-2", title: "Rejected Role", current_status: "rejected" }),
    ];

    render(
      <KanbanBoard applications={applications} onRefresh={vi.fn()} onOpenApplication={vi.fn()} />,
    );

    await screen.findByText("Inbox Role");
    expect(screen.queryByText("Rejected Role")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /closed/i })).not.toBeInTheDocument();
  });

  it("points to Closed opportunities when there are no active cards", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
    const onOpenClosed = vi.fn();

    render(
      <KanbanBoard
        applications={[]}
        closedCount={2}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
        onOpenClosed={onOpenClosed}
      />,
    );

    expect(await screen.findByText("No active opportunities")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View closed opportunities" }));
    expect(onOpenClosed).toHaveBeenCalledOnce();
  });

  it("does not render a 'Move to...' select on a collapsed card", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(
      <KanbanBoard
        applications={[makeApplication()]}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Senior Engineer");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves a card to a new status by dropping it onto a different column", async () => {
    const requests: { url: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      if (url.includes("/status") && init?.method === "POST") {
        requests.push({ url, body: String(init.body) });
        return jsonResponse({ application: makeApplication({ current_status: "shortlisted" }) });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const applications = [makeApplication({ current_status: "saved" })];

    render(
      <KanbanBoard applications={applications} onRefresh={onRefresh} onOpenApplication={vi.fn()} />,
    );

    await screen.findByText("Senior Engineer");
    fireEvent.drop(screen.getByRole("region", { name: /shortlist/i }), {
      dataTransfer: { getData: () => "app-1" },
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]?.url).toContain("/api/applications/app-1/status");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({ status: "shortlisted" });
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it("does not send a status update when a card is dropped back into its own column", async () => {
    const statusRequests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      if (url.includes("/status") && init?.method === "POST") {
        statusRequests.push(String(init.body));
        return jsonResponse({});
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(
      <KanbanBoard
        applications={[makeApplication({ current_status: "saved" })]}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
      />,
    );

    fireEvent.drop(screen.getByRole("region", { name: /inbox/i }), {
      dataTransfer: { getData: () => "app-1" },
    });

    await waitFor(() => {
      expect(screen.getByText("Senior Engineer")).toBeVisible();
    });
    expect(statusRequests).toHaveLength(0);
  });

  it("opens the opportunity detail view when a card is selected", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const onOpenApplication = vi.fn();
    render(
      <KanbanBoard
        applications={[makeApplication()]}
        onRefresh={vi.fn()}
        onOpenApplication={onOpenApplication}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Senior Engineer/i }));
    expect(onOpenApplication).toHaveBeenCalledWith("app-1");
  });

  it("shows manual labels and derived attention badges on a card", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({
          tasks: [
            {
              id: "task-1",
              application_id: "app-1",
              title: "Follow up",
              description: null,
              due_at: "2000-01-01T00:00:00.000Z",
              is_completed: false,
              completed_at: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    const applications = [
      makeApplication({
        current_status: "applied",
        labels: [{ id: "label-1", name: "Dream job", color: null, created_at: "", updated_at: "" }],
      }),
    ];

    render(
      <KanbanBoard applications={applications} onRefresh={vi.fn()} onOpenApplication={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Dream job")).toBeVisible();
    });
    expect(screen.getByText("Overdue")).toBeVisible();
  });
});
