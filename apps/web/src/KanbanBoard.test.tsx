import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummary } from "./api";
import { KanbanBoard, orderAfterDrop } from "./KanbanBoard";

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
    board_position: 0,
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
      if (url.includes("/board-position") && init?.method === "POST") {
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
    expect(requests[0]?.url).toContain("/api/applications/app-1/board-position");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      status: "shortlisted",
      orderedIds: ["app-1"],
    });
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
      if (url.includes("/board-position") && init?.method === "POST") {
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

    // The card now carries two controls naming the role -- the title and the
    // reorder handle -- so this has to say which one it means.
    fireEvent.click(
      await screen.findByRole("button", { name: /^Senior Engineer\s*Acme/i }),
    );
    expect(onOpenApplication).toHaveBeenCalledWith("app-1");
  });

  it("opens the opportunity detail view when any non-interactive part of a card is clicked", async () => {
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

    const meta = await screen.findByText("acme.example");
    fireEvent.pointerDown(meta, { clientX: 40, clientY: 60 });
    fireEvent.click(meta, { clientX: 41, clientY: 61 });

    expect(onOpenApplication).toHaveBeenCalledTimes(1);
    expect(onOpenApplication).toHaveBeenCalledWith("app-1");
  });

  it("does not open the detail view when a card press turns into a drag", async () => {
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

    const meta = await screen.findByText("acme.example");
    const card = meta.closest("article") as HTMLElement;

    fireEvent.pointerDown(card, { clientX: 40, clientY: 60 });
    fireEvent.dragStart(card, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.click(card, { clientX: 220, clientY: 60 });

    expect(onOpenApplication).not.toHaveBeenCalled();

    // A plain click after the drag finishes opens the card again.
    fireEvent.dragEnd(card);
    fireEvent.pointerDown(card, { clientX: 40, clientY: 60 });
    fireEvent.click(card, { clientX: 40, clientY: 60 });
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

describe("orderAfterDrop", () => {
  it("moves a card down within its own column", () => {
    // The user aimed at index 2 of the list they could see, which still
    // contained the card being dragged.
    expect(orderAfterDrop(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
  });

  it("moves a card up within its own column", () => {
    expect(orderAfterDrop(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("inserts a card arriving from another column", () => {
    expect(orderAfterDrop(["a", "b"], "new", 1)).toEqual(["a", "new", "b"]);
  });

  it("appends when the index is past the end", () => {
    expect(orderAfterDrop(["a", "b"], "new", 99)).toEqual(["a", "b", "new"]);
  });

  it("prepends when the index is negative", () => {
    expect(orderAfterDrop(["a", "b"], "new", -3)).toEqual(["new", "a", "b"]);
  });

  it("treats a drop into the gap a card already occupies as a no-op", () => {
    expect(orderAfterDrop(["a", "b", "c"], "b", 2)).toEqual(["a", "b", "c"]);
  });

  it("never duplicates the moved card", () => {
    expect(orderAfterDrop(["a", "b", "c"], "b", 3)).toEqual(["a", "c", "b"]);
  });
});

describe("KanbanBoard reordering", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // jsdom has no DragEvent, and fireEvent.dragOver therefore drops the mouse
  // coordinates the drop position is derived from. A real MouseEvent carries
  // them, and React reads clientY straight off the native event.
  function dragOverAt(card: HTMLElement, top: number, height: number, clientY: number) {
    card.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent(card, new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY }));
  }

  function mockBoardFetch(captured: { url: string; body: string }[]) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      if (url.includes("/board-position") && init?.method === "POST") {
        captured.push({ url, body: String(init.body) });
        return jsonResponse({ application: makeApplication() });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  const threeInInbox = [
    makeApplication({ id: "app-1", title: "First", current_status: "saved", board_position: 0 }),
    makeApplication({ id: "app-2", title: "Second", current_status: "saved", board_position: 1 }),
    makeApplication({ id: "app-3", title: "Third", current_status: "saved", board_position: 2 }),
  ];

  it("reorders within a column when a card is dropped on the top half of another card", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    // Hover the top half of the first card, then drop on the column.
    dragOverAt(screen.getByText("First").closest("article") as HTMLElement, 100, 100, 120);

    fireEvent.drop(screen.getByRole("region", { name: /inbox/i }), {
      dataTransfer: { getData: () => "app-3" },
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      status: "saved",
      orderedIds: ["app-3", "app-1", "app-2"],
    });
  });

  it("drops below a card when the pointer is over its bottom half", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    dragOverAt(screen.getByText("First").closest("article") as HTMLElement, 100, 100, 180);

    fireEvent.drop(screen.getByRole("region", { name: /inbox/i }), {
      dataTransfer: { getData: () => "app-3" },
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      orderedIds: ["app-1", "app-3", "app-2"],
    });
  });

  it("clears the drop indicator when a drag is abandoned without a drop", async () => {
    mockBoardFetch([]);

    const { container } = render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    const first = screen.getByText("First").closest("article") as HTMLElement;
    dragOverAt(first, 100, 100, 120);
    expect(container.querySelectorAll(".kanban-drop-indicator")).toHaveLength(1);

    // Escape-cancelling a drag fires dragend and nothing else.
    fireEvent.dragEnd(first);

    await waitFor(() => {
      expect(container.querySelectorAll(".kanban-drop-indicator")).toHaveLength(0);
    });
  });

  it("sends no request when a card is dropped back into the position it already held", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Second");

    dragOverAt(screen.getByText("Second").closest("article") as HTMLElement, 100, 100, 120);

    fireEvent.drop(screen.getByRole("region", { name: /inbox/i }), {
      dataTransfer: { getData: () => "app-2" },
    });

    await waitFor(() => {
      expect(screen.getByText("Second")).toBeVisible();
    });
    expect(requests).toHaveLength(0);
  });

  it("carries the destination column's full order when a card crosses columns", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={[
          makeApplication({ id: "app-1", title: "Moving", current_status: "saved" }),
          makeApplication({ id: "app-2", title: "Sitting", current_status: "shortlisted" }),
        ]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Sitting");

    dragOverAt(screen.getByText("Sitting").closest("article") as HTMLElement, 100, 100, 120);

    fireEvent.drop(screen.getByRole("region", { name: /shortlist/i }), {
      dataTransfer: { getData: () => "app-1" },
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      status: "shortlisted",
      orderedIds: ["app-1", "app-2"],
    });
  });

  it("reorders from the keyboard, so the board is usable without dragging", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder third/i }), {
      key: "ArrowUp",
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      status: "saved",
      orderedIds: ["app-1", "app-3", "app-2"],
    });
  });

  // Every keyboard test used to press ArrowUp, which is the one direction
  // where the "final index" and "drop gap index" conventions coincide. Moving
  // down exercises the conversion between them, and its absence hid a bug
  // where a downward keyboard move computed an unchanged order and was
  // silently swallowed by the no-op guard -- so no request was ever sent.
  it("moves a card down with the down arrow key", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder first/i }), {
      key: "ArrowDown",
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      status: "saved",
      orderedIds: ["app-2", "app-1", "app-3"],
    });
  });

  it("moves the middle card down past the last one", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder second/i }), {
      key: "ArrowDown",
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      orderedIds: ["app-1", "app-3", "app-2"],
    });
  });

  it("sends nothing when the last card is pushed further down", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Third");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder third/i }), {
      key: "ArrowDown",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(0);
  });

  it("moves a card to the next column with the right arrow key", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={[makeApplication({ id: "app-1", title: "First", current_status: "saved" })]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("First");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder first/i }), {
      key: "ArrowRight",
    });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({ status: "shortlisted" });
  });

  it("does nothing when a card is already at the top and is moved up", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("First");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder first/i }), { key: "ArrowUp" });

    await waitFor(() => {
      expect(screen.getByText("First")).toBeVisible();
    });
    expect(requests).toHaveLength(0);
  });

  it("refuses a drop the status taxonomy does not allow", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);

    // A closed card is never rendered in a column, but the drop handler
    // resolves ids against the caller's full list, so the guard has to hold.
    render(
      <KanbanBoard
        applications={[
          makeApplication({ id: "app-1", title: "Active", current_status: "saved" }),
          makeApplication({ id: "app-9", title: "Done", current_status: "rejected" }),
        ]}
        onRefresh={vi.fn()}
        onOpenApplication={vi.fn()}
      />,
    );

    await screen.findByText("Active");

    fireEvent.drop(screen.getByRole("region", { name: /shortlist/i }), {
      dataTransfer: { getData: () => "app-9" },
    });

    await waitFor(() => {
      expect(screen.getByText(/can't move directly/i)).toBeVisible();
    });
    expect(requests).toHaveLength(0);
  });

  it("does not open the detail view when the reorder handle is used", async () => {
    const requests: { url: string; body: string }[] = [];
    mockBoardFetch(requests);
    const onOpenApplication = vi.fn();

    render(
      <KanbanBoard
        applications={threeInInbox}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={onOpenApplication}
      />,
    );

    await screen.findByText("Third");

    fireEvent.keyDown(screen.getByRole("button", { name: /reorder third/i }), { key: "ArrowUp" });

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(onOpenApplication).not.toHaveBeenCalled();
  });
});

describe("dismissing an opportunity from the board", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderBoard() {
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return jsonResponse({ application: makeApplication({ current_status: "dismissed" }) });
    });

    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenApplication = vi.fn();
    render(
      <KanbanBoard
        applications={[makeApplication({ title: "Senior Engineer" })]}
        onRefresh={onRefresh}
        onOpenApplication={onOpenApplication}
      />,
    );
    return { calls, onRefresh, onOpenApplication };
  }

  it("asks before dismissing, and explains that the row is kept", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Senior Engineer" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/kept under More/i)).toBeVisible();
    // The whole reason this is a dismissal rather than a delete.
    expect(within(dialog).getByText(/will not propose this posting again/i)).toBeVisible();
  });

  it("does nothing at all when the confirmation is cancelled", async () => {
    const { calls, onRefresh } = renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Senior Engineer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("transitions to dismissed rather than deleting the opportunity", async () => {
    const { calls, onRefresh } = renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Senior Engineer" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // A DELETE here would drop the row, and with it the suppression that stops
    // an agent re-proposing the posting.
    expect(calls[0]?.url).toContain("/status");
    expect(calls[0]?.body).toMatchObject({ status: "dismissed" });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("does not open the detail view when the trash control is pressed", () => {
    const { onOpenApplication } = renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Senior Engineer" }));

    expect(onOpenApplication).not.toHaveBeenCalled();
  });

  it("reports a failure instead of leaving the card looking dismissed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      return jsonResponse({ error: "nope" }, { status: 500 });
    });

    render(
      <KanbanBoard
        applications={[makeApplication({ title: "Senior Engineer" })]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenApplication={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Senior Engineer" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("Senior Engineer")).toBeVisible();
  });
});
