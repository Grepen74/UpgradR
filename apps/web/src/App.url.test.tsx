import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function pasteUrl() {
  const event = createEvent.paste(document.body, {
    clipboardData: { getData: (type: string) => type === "text/plain" ? "https://example.com/job" : "" },
  });
  fireEvent(document.body, event);
  return event;
}

function mockWorkspace(signedIn = true) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    let body: unknown;
    if (url.includes("/api/session")) {
      body = { user: signedIn ? { id: "user-1", email: "person@example.com" } : null };
    } else if (url.includes("/api/auth/sign-out")) {
      body = {};
    } else if (url.includes("/api/dashboard")) {
      body = { proposals: 0, active: 0, overdue: 0 };
    } else if (url.endsWith("/api/applications")) {
      body = { applications: [] };
    } else if (url.includes("/api/applications/")) {
      return new Response(JSON.stringify({ error: "Fixture detail unavailable" }), { status: 404 });
    } else {
      const key = url.includes("/api/activity") ? "events" : url.split("/api/")[1]?.split("?")[0];
      body = { [key ?? "tasks"]: [] };
    }
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
}

describe("App Overview URL shortcut scope", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("does not install the shortcut on sign-in", async () => {
    mockWorkspace(false);
    render(<App />);
    await screen.findByLabelText("Email address");
    expect(pasteUrl().defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
  });

  it("cleans up on tab navigation and sign-out and enables again on Overview", async () => {
    mockWorkspace();
    render(<App />);
    await screen.findByRole("button", { name: "Add opportunity" });
    expect(pasteUrl().defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/job");
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    expect(pasteUrl().defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(pasteUrl().defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByLabelText("Email address");
    expect(pasteUrl().defaultPrevented).toBe(false);
  });

  it("disables the mounted board behind detail and re-enables after closing it", async () => {
    window.history.replaceState({}, "", "/applications/app-1");
    mockWorkspace();
    render(<App />);
    await screen.findByRole("dialog");
    expect(pasteUrl().defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Job posting URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close opportunity detail" }));
    expect(pasteUrl().defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Job posting URL")).toHaveValue("https://example.com/job");
  });
});
