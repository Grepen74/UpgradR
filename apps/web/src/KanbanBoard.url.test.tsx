import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummary } from "./api";
import { KanbanBoard } from "./KanbanBoard";
import { opportunityDragType } from "./lib/opportunityUrl";

const application: ApplicationSummary = {
  id: "app-1", title: "Engineer", company_name: "Acme", location: null,
  source_url: "https://acme.example/job", source_provider: "acme.example",
  current_status: "saved", closing_date: null, match_score: null, confidence: null,
  mcp_client_id: null, board_position: 0, created_at: "", updated_at: "", labels: [],
};

function transfer(plain: string, uriList = "", types = ["text/plain"]) {
  return {
    types, files: [], dropEffect: "",
    getData: (type: string) => type === "text/uri-list" ? uriList : type === "text/plain" ? plain : "",
  };
}

function paste(target: Element | Document, text: string) {
  const event = createEvent.paste(target, { clipboardData: transfer(text) });
  fireEvent(target, event);
  return event;
}

function drop(target: Element | Document, text: string, uriList = "") {
  const event = createEvent.drop(target, { dataTransfer: transfer(text, uriList) });
  fireEvent(target, event);
  return event;
}

describe("Overview URL shortcuts", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ tasks: [] })));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function board(applications: ApplicationSummary[] = [], enabled = true) {
    return render(<KanbanBoard applications={applications} urlShortcutsEnabled={enabled}
      onRefresh={vi.fn()} onOpenApplication={vi.fn()} />);
  }

  it("opens an empty board's form from a URL drop and focuses Role without a write", async () => {
    board();
    expect(drop(screen.getByText("No opportunities yet"), "www.example.com/jobs/1").defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://www.example.com/jobs/1");
    expect(screen.getByLabelText("Role")).toHaveFocus();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/api/tasks");
  });

  it.each(["card", "column", "header"])("opens from a URL dropped on a populated %s without moving cards", async (target) => {
    const { container } = board([application]);
    const element = target === "card" ? screen.getByText("Engineer").closest("article")!
      : target === "column" ? screen.getByRole("region", { name: /shortlist/i })
      : screen.getByText("Every opportunity, one place to move it forward");
    fireEvent.dragOver(element, { dataTransfer: transfer("", "", ["text/uri-list"]) });
    expect(screen.getByText("Drop one job posting URL to prefill Add opportunity")).toBeVisible();
    expect(container.querySelector(".kanban-drop-indicator")).toBeNull();
    expect(drop(element, "Browser title", "https://example.com/job?ref=tab#apply").defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/job?ref=tab#apply");
    expect(screen.queryByText("Drop one job posting URL to prefill Add opportunity")).toBeNull();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("prefills from native paste and replaces only URL in an open draft", () => {
    board();
    expect(paste(document.body, "https://example.com/one").defaultPrevented).toBe(true);
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Senior Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Example" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Remote" } });
    paste(document.body, "https://example.com/two");
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/two");
    expect(screen.getByLabelText("Role")).toHaveValue("Senior Engineer");
    expect(screen.getByLabelText("Company")).toHaveValue("Example");
    expect(screen.getByLabelText("Location")).toHaveValue("Remote");
  });

  it("starts fresh when the form is manually closed and reopened", () => {
    board();
    paste(document.body, "https://example.com/job");
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    fireEvent.click(screen.getByRole("button", { name: "Add opportunity" }));
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("");
  });

  it.each(["Role", "Company", "Job posting URL"])("preserves native paste/drop into %s", (label) => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "Add opportunity" }));
    const input = screen.getByLabelText(label);
    expect(paste(input, "https://example.com/job").defaultPrevented).toBe(false);
    expect(drop(input, "https://example.com/job").defaultPrevented).toBe(false);
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("");
  });

  it("preserves paste into textarea and descendants of contenteditable", () => {
    board();
    const { getByTestId } = render(<><textarea data-testid="text" /><div contentEditable suppressContentEditableWarning>
      <span data-testid="editable">Edit me</span>
    </div></>);
    expect(paste(getByTestId("text"), "https://example.com/job").defaultPrevented).toBe(false);
    expect(paste(getByTestId("editable"), "https://example.com/job").defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });

  it.each(["javascript:alert(1)", "https://example.com/one\nhttps://example.com/two"])(
    "shows feedback for rejected input without modifying the draft: %s", (text) => {
      board([application]);
      paste(document.body, "https://example.com/job");
      expect(drop(screen.getByRole("region", { name: /inbox/i }), text).defaultPrevented).toBe(true);
      expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/job");
      expect(screen.getByText(/one.*job posting URL/i, { selector: ".form-message" })).toBeVisible();
    },
  );

  it("leaves unrelated clipboard content alone", () => {
    board();
    expect(paste(document.body, "Senior Engineer").defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });

  it("disables prefill behind opportunity detail and clears drag feedback", () => {
    const { rerender } = board();
    fireEvent.dragOver(document.body, { dataTransfer: transfer("") });
    rerender(<KanbanBoard applications={[]} urlShortcutsEnabled={false}
      onRefresh={vi.fn()} onOpenApplication={vi.fn()} />);
    expect(screen.queryByText("Drop one job posting URL to prefill Add opportunity")).toBeNull();
    expect(paste(document.body, "https://example.com/job").defaultPrevented).toBe(false);
    expect(drop(document.body, "https://example.com/job").defaultPrevented).toBe(true);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });

  it("disables prefill during dismissal confirmation", () => {
    board([application]);
    fireEvent.click(screen.getByRole("button", { name: /dismiss engineer/i }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    paste(document.body, "https://example.com/job");
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  it("disables prefill while saving and clears URL after success", async () => {
    let completeSave: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(async (_input, init) => init?.method === "POST"
      ? new Promise<Response>((resolve) => { completeSave = resolve; })
      : new Response(JSON.stringify({ tasks: [] })));
    board();
    paste(document.body, "https://example.com/one");
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save opportunity" }));
    await screen.findByRole("button", { name: "Saving..." });
    paste(document.body, "https://example.com/two");
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/one");
    completeSave(new Response(JSON.stringify({ id: "new" })));
    await screen.findByRole("button", { name: "Add opportunity" });
    fireEvent.click(screen.getByRole("button", { name: "Add opportunity" }));
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("");
  });

  it("cleans up listeners when the board unmounts", () => {
    const { unmount } = board();
    unmount();
    expect(paste(document.body, "https://example.com/job").defaultPrevented).toBe(false);
    expect(drop(document.body, "https://example.com/job").defaultPrevented).toBe(false);
  });

  it("keeps the URL cue across nested drag targets and clears it when leaving the page", () => {
    board([application]);
    const column = screen.getByRole("region", { name: /inbox/i });
    const card = screen.getByText("Engineer").closest("article")!;
    const dataTransfer = transfer("");
    fireEvent.dragEnter(column, { dataTransfer });
    fireEvent.dragOver(column, { dataTransfer });
    fireEvent.dragEnter(card, { dataTransfer });
    fireEvent.dragLeave(column);
    expect(screen.getByText("Drop one job posting URL to prefill Add opportunity")).toBeVisible();
    fireEvent.dragLeave(card);
    expect(screen.queryByText("Drop one job posting URL to prefill Add opportunity")).toBeNull();
  });

  it("does not intercept file paste", () => {
    board();
    const event = createEvent.paste(document.body, {
      clipboardData: { ...transfer("https://example.com/job"), files: [new File(["job"], "job.txt")] },
    });
    fireEvent(document.body, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });

  it("keeps internal marked card drops on the existing move path", async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) =>
      new Response(JSON.stringify(init?.method === "POST" ? { application } : { tasks: [] })));
    board([application]);
    const dataTransfer = transfer("app-1", "", [opportunityDragType, "text/plain"]);
    fireEvent.dragOver(screen.getByRole("region", { name: /shortlist/i }), { dataTransfer });
    expect(screen.queryByText("Drop one job posting URL to prefill Add opportunity")).toBeNull();
    fireEvent.drop(screen.getByRole("region", { name: /shortlist/i }), { dataTransfer });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input).includes("/board-position"))).toBe(true));
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });
});
