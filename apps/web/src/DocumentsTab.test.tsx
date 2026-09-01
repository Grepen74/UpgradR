import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummary } from "./api";
import { DocumentsTab } from "./DocumentsTab";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : (input as Request).url ?? String(input);
}

const applications: ApplicationSummary[] = [
  {
    id: "app-1",
    title: "Senior Engineer",
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
  },
];

const emptyDocumentsResponse = {
  documents: [],
  quota: { usedBytes: 0, maxBytes: 209_715_200, count: 0, maxCount: 100 },
};

describe("DocumentsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no documents", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(emptyDocumentsResponse));

    render(<DocumentsTab applications={applications} />);

    await waitFor(() => {
      expect(screen.getByText(/no documents yet/i)).toBeVisible();
    });
  });

  it("renders a document with its quota, kind, size, and linked opportunity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        documents: [
          {
            id: "doc-1",
            kind: "resume",
            file_name: "resume.pdf",
            mime_type: "application/pdf",
            size_bytes: 1_048_576,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            links: [
              {
                id: "link-1",
                document_id: "doc-1",
                application_id: "app-1",
                role: "resume",
                created_at: "2024-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
        quota: { usedBytes: 1_048_576, maxBytes: 209_715_200, count: 1, maxCount: 100 },
      }),
    );

    render(<DocumentsTab applications={applications} />);

    await waitFor(() => {
      expect(screen.getByText("resume.pdf")).toBeVisible();
    });
    const row = screen.getByText("resume.pdf").closest("li");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/1\.0 MB/)).toBeVisible();
    expect(screen.getByText(/senior engineer · acme/i)).toBeVisible();
  });

  it("rejects an unsupported file client-side before uploading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(emptyDocumentsResponse));

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeVisible());

    const file = new File(["binary"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/file \(pdf, word, or plain text/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));

    await waitFor(() => {
      expect(screen.getByText(/only pdf, word/i)).toBeVisible();
    });
  });

  it("uploads a valid file via multipart/form-data and refreshes the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input as RequestInfo);
      if (init?.method === "POST" && url.includes("/api/documents")) {
        expect(init.body).toBeInstanceOf(FormData);
        return jsonResponse(
          {
            document: {
              id: "doc-2",
              kind: "resume",
              file_name: "resume.pdf",
              mime_type: "application/pdf",
              size_bytes: 2048,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
              links: [],
            },
          },
          { status: 201 },
        );
      }
      return jsonResponse(emptyDocumentsResponse);
    });

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeVisible());

    const file = new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/file \(pdf, word, or plain text/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));

    await waitFor(() => {
      expect(screen.getByText(/resume\.pdf uploaded/i)).toBeVisible();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
  });

  it("surfaces a quota-exceeded error returned by the API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input as RequestInfo);
      if (init?.method === "POST" && url.includes("/api/documents")) {
        return jsonResponse({ error: "Storage quota exceeded" }, { status: 413 });
      }
      return jsonResponse(emptyDocumentsResponse);
    });

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeVisible());

    const file = new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/file \(pdf, word, or plain text/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload document/i }));

    await waitFor(() => {
      expect(screen.getByText(/storage quota exceeded/i)).toBeVisible();
    });
  });

  it("requests a signed download URL and opens it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input as RequestInfo);
      if (url.includes("/download")) {
        return jsonResponse({
          url: "https://storage.example/signed/resume.pdf",
          expiresAt: "2024-01-01T00:01:00.000Z",
        });
      }
      return jsonResponse({
        documents: [
          {
            id: "doc-1",
            kind: "resume",
            file_name: "resume.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-01T00:00:00.000Z",
            links: [],
          },
        ],
        quota: { usedBytes: 2048, maxBytes: 209_715_200, count: 1, maxCount: 100 },
      });
    });
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText("resume.pdf")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith(
        "https://storage.example/signed/resume.pdf",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("deletes a document after confirmation from the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input as RequestInfo);
      if (init?.method === "DELETE" && url.includes("/api/documents/doc-1")) {
        return jsonResponse({ deleted: true });
      }
      if (url.endsWith("/api/documents")) {
        return jsonResponse({
          documents: [
            {
              id: "doc-1",
              kind: "resume",
              file_name: "resume.pdf",
              mime_type: "application/pdf",
              size_bytes: 2048,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
              links: [],
            },
          ],
          quota: { usedBytes: 2048, maxBytes: 209_715_200, count: 1, maxCount: 100 },
        });
      }
      return jsonResponse(emptyDocumentsResponse);
    });

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText("resume.pdf")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/resume\.pdf deleted/i)).toBeVisible();
    });
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => init?.method === "DELETE",
      ),
    ).toBe(true);
  });

  it("links a document to an opportunity and can unlink it", async () => {
    let linked = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = requestUrl(input as RequestInfo);
      if (init?.method === "POST" && url.includes("/links")) {
        linked = true;
        return jsonResponse(
          {
            link: {
              id: "link-1",
              document_id: "doc-1",
              application_id: "app-1",
              role: "resume",
              created_at: "2024-01-01T00:00:00.000Z",
            },
          },
          { status: 201 },
        );
      }
      if (url.endsWith("/api/documents")) {
        return jsonResponse({
          documents: [
            {
              id: "doc-1",
              kind: "resume",
              file_name: "resume.pdf",
              mime_type: "application/pdf",
              size_bytes: 2048,
              created_at: "2024-01-01T00:00:00.000Z",
              updated_at: "2024-01-01T00:00:00.000Z",
              links: linked
                ? [
                    {
                      id: "link-1",
                      document_id: "doc-1",
                      application_id: "app-1",
                      role: "resume",
                      created_at: "2024-01-01T00:00:00.000Z",
                    },
                  ]
                : [],
            },
          ],
          quota: { usedBytes: 2048, maxBytes: 209_715_200, count: 1, maxCount: 100 },
        });
      }
      return jsonResponse(emptyDocumentsResponse);
    });

    render(<DocumentsTab applications={applications} />);
    await waitFor(() => expect(screen.getByText("resume.pdf")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /link to opportunity/i }));
    const linkForm = screen.getByRole("form", { name: /link resume\.pdf to an opportunity/i });
    fireEvent.change(within(linkForm).getByLabelText(/opportunity/i), {
      target: { value: "app-1" },
    });
    fireEvent.click(within(linkForm).getByRole("button", { name: /^link$/i }));

    await waitFor(() => {
      expect(screen.getByText(/senior engineer · acme/i)).toBeVisible();
    });

    const unlinkButton = screen.getByRole("button", {
      name: /unlink resume\.pdf from senior engineer · acme/i,
    });
    fireEvent.click(unlinkButton);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([callInput, callInit]) =>
            callInit?.method === "DELETE" && requestUrl(callInput as RequestInfo).includes("/links/link-1"),
        ),
      ).toBe(true);
    });
  });
});
