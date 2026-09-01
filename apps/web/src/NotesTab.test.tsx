import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotesTab } from "./NotesTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockNotesFetch({
  notes = [],
  companies = [],
  contacts = [],
}: {
  notes?: unknown[];
  companies?: unknown[];
  contacts?: unknown[];
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/notes")) {
      return jsonResponse({ notes });
    }
    if (url.includes("/api/companies")) {
      return jsonResponse({ companies });
    }
    if (url.includes("/api/contacts")) {
      return jsonResponse({ contacts });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

describe("NotesTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no notes", async () => {
    mockNotesFetch({});

    render(<NotesTab applications={[]} />);

    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeVisible();
    });
  });

  it("renders a note linked to a company", async () => {
    mockNotesFetch({
      notes: [
        {
          id: "note-1",
          application_id: null,
          company_id: "company-1",
          contact_id: null,
          body: "Great first call.",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
      companies: [
        {
          id: "company-1",
          name: "Acme Corp",
          website_url: null,
          industry: null,
          size_range: null,
          notes: null,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    render(<NotesTab applications={[]} />);

    await waitFor(() => {
      expect(screen.getByText("Great first call.")).toBeVisible();
    });
    expect(screen.getByText(/Acme Corp ·/)).toBeVisible();
  });

  it("submits a new note via POST /api/notes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/notes")) {
        return jsonResponse(
          {
            note: {
              id: "note-2",
              application_id: null,
              company_id: null,
              contact_id: null,
              body: "New note text",
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      if (url.includes("/api/notes")) {
        return jsonResponse({ notes: [] });
      }
      if (url.includes("/api/companies")) {
        return jsonResponse({ companies: [] });
      }
      return jsonResponse({ contacts: [] });
    });

    render(<NotesTab applications={[]} />);
    await waitFor(() => expect(screen.getByText(/no notes yet/i)).toBeVisible());

    fireEvent.change(screen.getByLabelText(/^note$/i), { target: { value: "New note text" } });
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.body).toBe("New note text");
  });
});
