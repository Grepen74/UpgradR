import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompaniesTab } from "./CompaniesTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("CompaniesTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no companies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ companies: [] }));

    render(<CompaniesTab />);

    await waitFor(() => {
      expect(screen.getByText(/no companies yet/i)).toBeVisible();
    });
  });

  it("renders existing companies with their details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        companies: [
          {
            id: "company-1",
            name: "Acme Corp",
            website_url: "https://acme.example",
            industry: "Software",
            size_range: "51-200",
            notes: null,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    render(<CompaniesTab />);

    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeVisible();
    });
    expect(screen.getByText("Software · 51-200")).toBeVisible();
  });

  it("submits a new company via POST /api/companies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/api/companies")) {
        return jsonResponse(
          {
            company: {
              id: "company-2",
              name: "New Co",
              website_url: null,
              industry: null,
              size_range: null,
              notes: null,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      return jsonResponse({ companies: [] });
    });

    render(<CompaniesTab />);
    await waitFor(() => expect(screen.getByText(/no companies yet/i)).toBeVisible());

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Co" } });
    fireEvent.click(screen.getByRole("button", { name: /add company/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body.name).toBe("New Co");
  });

  it("deletes a company via DELETE /api/companies/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "DELETE") {
        return jsonResponse({ deleted: true });
      }
      return jsonResponse({
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
    });

    render(<CompaniesTab />);
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(deleteCall).toBeDefined();
    });
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    const url = typeof deleteCall?.[0] === "string" ? deleteCall[0] : (deleteCall?.[0] as Request).url;
    expect(url).toContain("/api/companies/company-1");
  });
});
