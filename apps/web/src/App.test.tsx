import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the sign-in experience for signed-out users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ user: null }));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /turn scattered opportunities/i })).toBeVisible();
    });
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
  });

  it("lets a signed-in user switch to the profile tab and load their headline", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      if (url.includes("/api/profile")) {
        return jsonResponse({
          profile: {
            headline: "Senior iOS Engineer",
            summary: null,
            is_confirmed: true,
            last_reviewed_at: null,
          },
        });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Profile" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/headline/i)).toHaveValue("Senior iOS Engineer");
    });
  });

  it("lets a signed-in user switch to the profile imports tab and see empty history", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("/api/session")) {
        return jsonResponse({ user: { id: "user-1", email: "person@example.com" } });
      }
      if (url.includes("/api/dashboard")) {
        return jsonResponse({ proposals: 0, active: 0, overdue: 0 });
      }
      if (url.includes("/api/applications")) {
        return jsonResponse({ applications: [] });
      }
      if (url.includes("/api/profile/imports")) {
        return jsonResponse({ imports: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /keep momentum visible/i })).toBeVisible();
    });

    fireEvent.click(screen.getByRole("button", { name: "Profile imports" }));

    await waitFor(() => {
      expect(screen.getByText(/no imports yet/i)).toBeVisible();
    });
    expect(
      screen.getByText(/upload a linkedin export or resume above to start a reviewable import/i),
    ).toBeVisible();
  });
});


