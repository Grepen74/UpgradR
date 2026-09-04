import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the sign-in experience for signed-out users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ user: null }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /turn scattered opportunities/i })).toBeVisible();
    });
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
  });

  it("lets a signed-in user open the profile menu and switch to the profile tab", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      if (url.includes("/api/preferences")) {
        return jsonResponse({
          targetRoles: [],
          locations: [],
          remotePolicy: "flexible",
          minimumCompensation: null,
          minimumCompensationPeriod: "month",
          compensationCurrency: null,
          industries: [],
          excludedCompanies: [],
          notes: null,
        });
      }
      if (url.includes("/api/profile")) {
        return jsonResponse({
          profile: {
            headline: "Senior iOS Engineer",
            summary: null,
            is_confirmed: true,
            last_reviewed_at: null,
          },
        });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /account settings menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/headline/i)).toHaveValue("Senior iOS Engineer");
    });
    expect(screen.getByRole("heading", { name: "Who you are" })).toBeVisible();
    expect(
      screen.getByText(/connected agents read this to understand your background/i),
    ).toBeVisible();
    // Search filters were folded into the profile page, so both halves render
    // together and there is no separate Preferences menu entry.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "What you're looking for" })).toBeVisible();
    });
    expect(screen.queryByRole("menuitem", { name: "Preferences" })).toBeNull();
  });

  it("lets a signed-in user open the profile menu and switch to profile imports", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      if (url.includes("/api/profile/imports")) {
        return jsonResponse({ imports: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /account settings menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile imports" }));

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });
    expect(
      screen.getByText(/upload a linkedin export or resume above to start a reviewable import/i),
    ).toBeVisible();
  });

  it("opens Account from the profile menu instead of the top-level nav", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    const nav = screen.getByRole("navigation", { name: /workspace sections/i });
    expect(nav.textContent).not.toMatch(/account/i);

    fireEvent.click(screen.getByRole("button", { name: /account settings menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Account" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /delete your account/i })).toBeVisible();
    });
    expect(screen.getByRole("heading", { name: /download a copy of your data/i })).toBeVisible();
  });

  it("closes the profile menu with Escape", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /account settings menu/i }));
    expect(screen.getByRole("menu", { name: /account settings/i })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: /account settings/i })).not.toBeInTheDocument();
    });
  });

  it("shows the active Kanban board as the default Overview landing content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    expect(screen.getByRole("button", { name: "Overview" })).toHaveClass("active");
    expect(
      screen.getByRole("heading", { name: "Every opportunity, one place to move it forward" }),
    ).toBeVisible();
  });

  it("moves the metrics/recent-opportunities content that used to be Overview into Summary", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 2, active: 1, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    expect(screen.queryByLabelText("Job search overview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Summary" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Job search overview")).toBeVisible();
    });
    expect(screen.getByText("Agent proposals")).toBeVisible();
  });

  it("excludes closed opportunities from the active board and lists them under More", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({
          applications: [
            {
              id: "app-active",
              title: "Active Role",
              company_name: "Acme",
              location: null,
              source_url: "https://acme.example/jobs/1",
              source_provider: "acme.example",
              current_status: "saved",
              match_score: null,
              confidence: null,
              mcp_client_id: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
              labels: [],
            },
            {
              id: "app-closed",
              title: "Closed Role",
              company_name: "Globex",
              location: null,
              source_url: "https://globex.example/jobs/1",
              source_provider: "globex.example",
              current_status: "rejected",
              match_score: null,
              confidence: null,
              mcp_client_id: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
              labels: [],
            },
          ],
        });
      }
      if (url.includes("/api/tasks")) {
        return jsonResponse({ tasks: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Active Role")).toBeVisible();
    });
    expect(screen.queryByText("Closed Role")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /closed opportunities/i }));

    await waitFor(() => {
      expect(screen.getByText("Closed Role")).toBeVisible();
    });
    expect(screen.queryByText("Active Role")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Back to More" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Follow-ups/ })).toBeVisible();
    });
  });

  it("normalizes a browser-style job posting URL before saving an opportunity", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications") && init?.method === "POST") {
        requests.push(init);
        return jsonResponse({ id: "application-1" });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add opportunity" }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Senior Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Example" } });
    fireEvent.change(screen.getByLabelText("Job posting URL"), {
      target: { value: "www.example.com/jobs/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save opportunity" }));

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add opportunity" })).toBeVisible();
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      sourceUrl: "https://www.example.com/jobs/1",
      sourceProvider: "www.example.com",
    });
  });
});
