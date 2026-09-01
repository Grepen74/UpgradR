import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "../shared/account";
import { AccountTab } from "./AccountTab";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : ((input as Request).url ?? String(input));
}

describe("AccountTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("downloads the export artifact returned by GET /api/account/export", async () => {
    const objectUrl = "blob:mock-account-export";
    const createObjectURL = vi.fn().mockReturnValue(objectUrl);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (requestUrl(input).includes("/api/account/export")) {
        return new Response(JSON.stringify({ export: { generatedAt: "now" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="upgradr-account-export-20260101T000000Z.json"',
          },
        });
      }
      throw new Error(`Unexpected request to ${requestUrl(input)}`);
    });

    render(<AccountTab onAccountDeleted={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /download my data/i }));

    await waitFor(() => {
      expect(screen.getByText(/export has started downloading/i)).toBeVisible();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  it("shows an error message when the export request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unable to export account data. Please try again." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AccountTab onAccountDeleted={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /download my data/i }));

    await waitFor(() => {
      expect(screen.getByText(/unable to export account data/i)).toBeVisible();
    });
  });

  it("keeps the delete button disabled until the exact confirmation phrase is typed", async () => {
    render(<AccountTab onAccountDeleted={() => undefined} />);

    const deleteButton = screen.getByRole("button", { name: /permanently delete my account/i });
    const input = screen.getByLabelText(/type .* to confirm/i);

    expect(deleteButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "delete my account" } });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(input, { target: { value: `${ACCOUNT_DELETION_CONFIRMATION_PHRASE} ` } });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(input, { target: { value: ACCOUNT_DELETION_CONFIRMATION_PHRASE } });
    expect(deleteButton).toBeEnabled();
  });

  it("submits DELETE /api/account with the typed confirmation and calls onAccountDeleted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (requestUrl(input).includes("/api/account") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request to ${requestUrl(input)}`);
    });

    const onAccountDeleted = vi.fn();
    render(<AccountTab onAccountDeleted={onAccountDeleted} />);

    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: ACCOUNT_DELETION_CONFIRMATION_PHRASE },
    });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete my account/i }));

    await waitFor(() => {
      expect(onAccountDeleted).toHaveBeenCalledTimes(1);
    });

    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    const body = JSON.parse(String(deleteCall?.[1]?.body));
    expect(body).toEqual({ confirmation: ACCOUNT_DELETION_CONFIRMATION_PHRASE });
  });

  it("shows an error message and does not call onAccountDeleted when deletion fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unable to remove stored files. Please try again." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const onAccountDeleted = vi.fn();
    render(<AccountTab onAccountDeleted={onAccountDeleted} />);

    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: ACCOUNT_DELETION_CONFIRMATION_PHRASE },
    });
    fireEvent.click(screen.getByRole("button", { name: /permanently delete my account/i }));

    await waitFor(() => {
      expect(screen.getByText(/unable to remove stored files/i)).toBeVisible();
    });
    expect(onAccountDeleted).not.toHaveBeenCalled();
  });
});
