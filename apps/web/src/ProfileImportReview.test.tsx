import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileImportReview } from "./ProfileImportReview";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const linkedInDetail = {
  id: "import-1",
  source: "linkedin",
  source_label: "LinkedIn export",
  parser_version: "profile-import-v1",
  status: "pending",
  imported_at: "2024-01-01T00:00:00.000Z",
  reviewed_at: null,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  raw_payload: {
    totals: { profile: 1, experiences: 1, education: 1, skills: 1 },
    filesProcessed: ["Positions.csv"],
    filesMissing: [],
    warnings: [],
    profile: {
      value: { headline: "Senior Engineer", summary: "Ten years of experience." },
      confirmed: false,
      source: { file: "Profile.csv", row: 2 },
    },
    experiences: [
      {
        value: {
          company: "Acme",
          title: "Engineer",
          description: null,
          startDate: null,
          endDate: null,
          isCurrent: true,
          rawStartDate: null,
          rawEndDate: null,
        },
        confirmed: false,
        source: { file: "Positions.csv", row: 2 },
      },
    ],
    education: [
      {
        value: {
          institution: "State University",
          degree: "BS Computer Science",
          fieldOfStudy: null,
          rawStartDate: null,
          rawEndDate: null,
        },
        confirmed: false,
        source: { file: "Education.csv", row: 2 },
      },
    ],
    skills: [
      {
        value: { name: "TypeScript", evidence: null },
        confirmed: false,
        source: { file: "Skills.csv", row: 2 },
      },
    ],
  },
};

describe("ProfileImportReview", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders LinkedIn preview items as checkboxes and confirms the selected ones", async () => {
    const onReviewed = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/import-1") && (!init || init.method === undefined)) {
        return jsonResponse({ import: linkedInDetail });
      }
      if (url.endsWith("/import-1/confirm") && init?.method === "POST") {
        return jsonResponse({
          confirmation: {
            importId: "import-1",
            status: "confirmed",
            confirmedProfile: false,
            confirmedExperiences: 1,
            confirmedEducation: 0,
            confirmedSkills: 0,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ProfileImportReview importId="import-1" onClose={onClose} onReviewed={onReviewed} />);

    await waitFor(() => {
      expect(screen.getByText("Engineer at Acme")).toBeVisible();
    });
    expect(screen.getByText(/BS Computer Science at State University/)).toBeVisible();
    expect(screen.getByText("TypeScript")).toBeVisible();

    // Nothing is selected yet, so confirm should be disabled.
    expect(screen.getByRole("button", { name: /confirm selected/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /engineer at acme/i }));
    expect(screen.getByRole("button", { name: /confirm selected/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /confirm selected/i }));

    await waitFor(() => {
      expect(screen.getByText(/confirmed.*1 experience/i)).toBeVisible();
    });
    expect(onReviewed).toHaveBeenCalled();

    const confirmCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(confirmCall).toBeDefined();
    const body = JSON.parse(String(confirmCall?.[1]?.body));
    expect(body).toEqual({
      confirmProfile: false,
      experienceIndexes: [0],
      educationIndexes: [],
      skillIndexes: [],
    });
  });

  it("discards the import and closes the panel", async () => {
    const onReviewed = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/import-1") && (!init || init.method === undefined)) {
        return jsonResponse({ import: linkedInDetail });
      }
      if (url.endsWith("/import-1/discard") && init?.method === "POST") {
        return jsonResponse({ import: { ...linkedInDetail, status: "discarded" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ProfileImportReview importId="import-1" onClose={onClose} onReviewed={onReviewed} />);

    await waitFor(() => {
      expect(screen.getByText("Engineer at Acme")).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /discard import/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm discard import/i }));

    await waitFor(() => {
      expect(onReviewed).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a load error message when the import cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Profile import not found" }, { status: 404 }),
    );

    render(
      <ProfileImportReview
        importId="missing"
        onClose={vi.fn()}
        onReviewed={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Profile import not found")).toBeVisible();
    });
  });
});
