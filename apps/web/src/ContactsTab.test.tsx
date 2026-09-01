import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactsTab } from "./ContactsTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockContactsFetch({
  contacts = [],
  companies = [],
}: {
  contacts?: unknown[];
  companies?: unknown[];
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/contacts")) {
      return jsonResponse({ contacts });
    }
    if (url.includes("/api/companies")) {
      return jsonResponse({ companies });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

describe("ContactsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no contacts", async () => {
    mockContactsFetch({});

    render(<ContactsTab />);

    await waitFor(() => {
      expect(screen.getByText(/no contacts yet/i)).toBeVisible();
    });
  });

  it("renders a contact with its role and company", async () => {
    mockContactsFetch({
      contacts: [
        {
          id: "contact-1",
          company_id: "company-1",
          full_name: "Jamie Rivera",
          role_title: "VP Engineering",
          email: "jamie@example.com",
          phone: null,
          linkedin_url: null,
          notes: null,
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

    render(<ContactsTab />);

    await waitFor(() => {
      expect(screen.getByText("Jamie Rivera")).toBeVisible();
    });
    expect(screen.getByText("VP Engineering · Acme Corp")).toBeVisible();
  });

  it("submits a new contact via POST /api/contacts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/contacts")) {
        return jsonResponse(
          {
            contact: {
              id: "contact-2",
              company_id: null,
              full_name: "New Contact",
              role_title: null,
              email: null,
              phone: null,
              linkedin_url: null,
              notes: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      if (url.includes("/api/contacts")) {
        return jsonResponse({ contacts: [] });
      }
      return jsonResponse({ companies: [] });
    });

    render(<ContactsTab />);
    await waitFor(() => expect(screen.getByText(/no contacts yet/i)).toBeVisible());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Contact" } });
    fireEvent.click(screen.getByRole("button", { name: /add contact/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
    });
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.fullName).toBe("New Contact");
  });
});
