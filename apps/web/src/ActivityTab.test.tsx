import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityTab } from "./ActivityTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("ActivityTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there is no activity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ events: [] }));

    render(<ActivityTab />);

    await waitFor(() => {
      expect(screen.getByText(/no activity yet/i)).toBeVisible();
    });
  });

  it("renders activity events with a human-readable summary", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        events: [
          {
            id: "event-1",
            entity_type: "company",
            entity_id: "company-1",
            event_type: "created",
            actor: "user",
            mcp_client_id: null,
            payload: { name: "Acme Corp" },
            created_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    render(<ActivityTab />);

    await waitFor(() => {
      expect(screen.getByText("Company added: Acme Corp")).toBeVisible();
    });
  });

  it("shows an agent badge for non-user actors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        events: [
          {
            id: "event-2",
            entity_type: "application",
            entity_id: "app-1",
            event_type: "created",
            actor: "agent",
            mcp_client_id: "client-1",
            payload: { title: "Staff Engineer" },
            created_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    render(<ActivityTab />);

    await waitFor(() => {
      expect(screen.getByText("agent")).toBeVisible();
    });
  });

  it("refetches with an entityType filter when a filter tab is selected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ events: [] }));

    render(<ActivityTab />);
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Companies" }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      const url = typeof lastCall?.[0] === "string" ? lastCall[0] : (lastCall?.[0] as Request).url;
      expect(url).toContain("entityType=company");
    });
  });
});
