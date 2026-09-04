import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummary } from "./api";
import { ClosedOpportunitiesTab } from "./ClosedOpportunitiesTab";

function makeApplication(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: "app-1",
    title: "Senior Engineer",
    company_name: "Acme",
    location: "Remote",
    source_url: "https://acme.example/jobs/1",
    source_provider: "acme.example",
    current_status: "rejected",
    match_score: 82,
    confidence: null,
    mcp_client_id: null,
    board_position: 0,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    labels: [],
    ...overrides,
  };
}

describe("ClosedOpportunitiesTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no closed opportunities", () => {
    render(<ClosedOpportunitiesTab applications={[]} onOpenApplication={vi.fn()} />);

    expect(screen.getByText(/nothing closed yet/i)).toBeVisible();
  });

  it("lists each closed opportunity with its outcome and a useful summary", () => {
    const applications = [
      makeApplication({ id: "app-1", title: "Rejected Role", current_status: "rejected" }),
      makeApplication({ id: "app-2", title: "Accepted Role", current_status: "accepted" }),
    ];

    render(<ClosedOpportunitiesTab applications={applications} onOpenApplication={vi.fn()} />);

    expect(screen.getByText("Rejected Role")).toBeVisible();
    expect(screen.getByText("rejected")).toBeVisible();
    expect(screen.getByText("Accepted Role")).toBeVisible();
    expect(screen.getByText("accepted")).toBeVisible();
  });

  it("opens the same opportunity detail overlay when a closed item is selected", () => {
    const onOpenApplication = vi.fn();
    render(
      <ClosedOpportunitiesTab
        applications={[makeApplication()]}
        onOpenApplication={onOpenApplication}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /senior engineer/i }));
    expect(onOpenApplication).toHaveBeenCalledWith("app-1");
  });
});
