import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileImportsTab } from "./ProfileImportsTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("ProfileImportsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty import history state when there are no prior imports", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ imports: [] }));

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });
  });

  it("renders prior import provenance with its status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        imports: [
          {
            id: "import-1",
            source: "resume",
            source_label: "resume.txt",
            parser_version: "profile-import-v1",
            status: "pending",
            raw_payload: {},
            imported_at: "2024-01-01T00:00:00.000Z",
            reviewed_at: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText("resume.txt")).toBeVisible();
    });
    expect(screen.getByText("pending")).toBeVisible();
  });

  it("parses a pasted resume client-side and shows an unconfirmed preview", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ imports: [] }));

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText(/or paste resume text/i), {
      target: { value: "Experienced engineer with a decade of shipping software." },
    });

    await waitFor(() => {
      expect(screen.getByText("Unconfirmed")).toBeVisible();
    });
    expect(screen.getByText("Characters captured as evidence")).toBeVisible();
  });

  it("submits a parsed resume preview via POST /api/profile/imports", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/profile/imports")) {
        return jsonResponse(
          {
            import: {
              id: "import-2",
              source: "resume",
              source_label: "Pasted resume text",
              parser_version: "profile-import-v1",
              status: "pending",
              raw_payload: {},
              imported_at: "2024-01-01T00:00:00.000Z",
              reviewed_at: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      return jsonResponse({ imports: [] });
    });

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText(/or paste resume text/i), {
      target: { value: "Experienced engineer with a decade of shipping software." },
    });

    await waitFor(() => {
      expect(screen.getByText("Unconfirmed")).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: /save for review/i }));

    await waitFor(() => {
      expect(screen.getByText(/resume saved for review/i)).toBeVisible();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.source).toBe("resume");
    expect(body.preview.evidence).toContain("Experienced engineer");
  });

  it("offers to remove contact details before they reach an agent-readable field", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/profile/imports")) {
        return jsonResponse(
          {
            import: {
              id: "import-3",
              source: "resume",
              source_label: "Pasted resume text",
              parser_version: "profile-import-v1",
              status: "pending",
              raw_payload: {},
              imported_at: "2024-01-01T00:00:00.000Z",
              reviewed_at: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      return jsonResponse({ imports: [] });
    });

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText(/or paste resume text/i), {
      target: {
        value: "John Ahlinder\njohn@example.com\n+46 70 123 45 67\nSenior iOS engineer.",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("john@example.com")).toBeVisible();
    });
    // Checked by default: this text ends up in candidate_profiles.summary,
    // which any agent holding profile:read can read.
    expect(screen.getByLabelText(/remove these before saving/i)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /save for review/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 contact details removed/i)).toBeVisible();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.preview.evidence).toContain("Senior iOS engineer.");
    expect(body.preview.evidence).not.toContain("john@example.com");
    expect(body.preview.evidence).not.toContain("+46");
  });

  it("keeps the contact details when the user opts out", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/profile/imports")) {
        return jsonResponse({ import: { id: "import-4" } }, { status: 201 });
      }
      return jsonResponse({ imports: [] });
    });

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText(/or paste resume text/i), {
      target: { value: "Contact me at john@example.com about iOS work." },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/remove these before saving/i)).toBeChecked();
    });
    fireEvent.click(screen.getByLabelText(/remove these before saving/i));

    fireEvent.click(screen.getByRole("button", { name: /save for review/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(String(postCall?.[1]?.body));
      expect(body.preview.evidence).toContain("john@example.com");
    });
  });

  it("does not offer removal when there is nothing to remove", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ imports: [] }));

    render(<ProfileImportsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText(/or paste resume text/i), {
      target: { value: "Senior iOS engineer, 2019 - 2024, shipped 4 500 000 sessions." },
    });

    await waitFor(() => {
      expect(screen.getByText("Unconfirmed")).toBeVisible();
    });
    expect(screen.queryByText(/contact details found/i)).toBeNull();
  });

  it("shows source file and row for parsed LinkedIn items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ imports: [] }));
    const csv = "Company Name,Title,Description,Started On,Finished On\nAcme,Engineer,,,\n";
    const file = new File([csv], "Positions.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    render(<ProfileImportsTab />);
    await waitFor(() => expect(screen.getByText(/no imports yet/i)).toBeVisible());

    fireEvent.change(screen.getByLabelText(/select one or more csv files/i), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText("Engineer at Acme")).toBeVisible();
    });
    expect(screen.getByText("Positions.csv, row 2")).toBeVisible();
  });
});
