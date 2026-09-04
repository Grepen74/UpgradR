import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuppressionsTab } from "./SuppressionsTab";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : ((input as Request).url ?? String(input));
}

function makeSuppression(overrides: Record<string, unknown> = {}) {
  return {
    id: "sup-1",
    key_type: "company",
    key_value: "acme inc",
    reason: "Not hiring at my level",
    source: "manual",
    expires_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockApi(options: {
  initial?: unknown[];
  onCreate?: (body: unknown) => void;
  onDelete?: (url: string) => void;
} = {}) {
  let rows = options.initial ?? [];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";

    if (url.includes("/api/suppressions") && method === "POST") {
      const body = JSON.parse(String(init?.body));
      options.onCreate?.(body);
      rows = [...rows, makeSuppression({ id: "sup-new", key_value: body.keyValue })];
      return new Response(JSON.stringify({ suppression: rows.at(-1) }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/suppressions/") && method === "DELETE") {
      options.onDelete?.(url);
      return new Response(JSON.stringify({ removed: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ suppressions: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("SuppressionsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("explains that closing an opportunity mutes it automatically", async () => {
    // Rules accumulate without being asked for, so the list has to say where
    // they come from or a user cannot reason about why proposals stopped.
    mockApi();
    render(<SuppressionsTab />);

    expect(
      await screen.findByText(/Closing an opportunity as rejected, withdrawn, or dismissed/i),
    ).toBeVisible();
  });

  it("shows an empty state rather than an empty list", async () => {
    mockApi();
    render(<SuppressionsTab />);

    expect(await screen.findByText(/Nothing is muted/i)).toBeVisible();
  });

  it("distinguishes an automatic rule from one the user added", async () => {
    mockApi({
      initial: [
        makeSuppression({ id: "sup-auto", source: "auto_closed", reason: "Closed as rejected" }),
      ],
    });
    render(<SuppressionsTab />);

    expect(await screen.findByText("Added when you closed an opportunity", { exact: false }))
      .toBeVisible();
  });

  it("says a company rule lapses and a posting rule does not", async () => {
    mockApi();
    render(<SuppressionsTab />);

    expect(await screen.findByText(/Lapses automatically after 180 days/i)).toBeVisible();
  });

  it("reports remaining days for an expiring rule", async () => {
    const expires = new Date(Date.now() + 3 * 86_400_000).toISOString();
    mockApi({ initial: [makeSuppression({ expires_at: expires })] });
    render(<SuppressionsTab />);

    expect(await screen.findByText(/Expires in 3 days/i)).toBeVisible();
  });

  it("shows a permanent rule as permanent", async () => {
    mockApi({ initial: [makeSuppression({ key_type: "canonical_url", expires_at: null })] });
    render(<SuppressionsTab />);

    expect(await screen.findByText(/Permanent/i)).toBeVisible();
  });

  it("submits a trimmed company rule", async () => {
    const onCreate = vi.fn();
    mockApi({ onCreate });
    render(<SuppressionsTab />);

    await screen.findByText(/Nothing is muted/i);
    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "  Acme, Inc.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({ keyType: "company", keyValue: "Acme, Inc." });
    });
  });

  it("keeps the submit button disabled until something is typed", async () => {
    mockApi();
    render(<SuppressionsTab />);

    await screen.findByText(/Nothing is muted/i);
    expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();
  });

  it("removes a rule and drops it from the list", async () => {
    const onDelete = vi.fn();
    mockApi({ initial: [makeSuppression()], onDelete });
    render(<SuppressionsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "Stop muting acme inc" }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText("acme inc")).not.toBeInTheDocument();
    });
  });

  it("surfaces a load failure instead of showing an empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 502 }),
    );
    render(<SuppressionsTab />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Unable to load/i);
  });
});
