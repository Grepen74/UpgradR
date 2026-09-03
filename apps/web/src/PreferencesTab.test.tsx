import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesTab } from "./PreferencesTab";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : ((input as Request).url ?? String(input));
}

const LOADED = {
  targetRoles: ["iOS developer"],
  locations: [],
  remotePolicy: "flexible",
  minimumCompensation: null,
  compensationCurrency: null,
  industries: [],
  excludedCompanies: [],
  notes: null,
};

function mockApi(options: { onSave?: (body: unknown) => void; saveStatus?: number } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/preferences") && (init?.method ?? "GET").toUpperCase() !== "GET") {
      options.onSave?.(JSON.parse(String(init?.body)));
      if (options.saveStatus && options.saveStatus >= 400) {
        return new Response(JSON.stringify({ error: "Unable to save job preferences." }), {
          status: options.saveStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(LOADED), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/preferences")) {
      return new Response(JSON.stringify(LOADED), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

async function findTargetRoles() {
  return (await screen.findByLabelText(/target roles/i)) as HTMLInputElement;
}

describe("PreferencesTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the stored values as comma-separated text", async () => {
    mockApi();
    render(<PreferencesTab />);
    expect((await findTargetRoles()).value).toBe("iOS developer");
  });

  // The original bug: state held a parsed array and the input re-formatted it
  // on every render, so a trailing space was trimmed away before the next
  // character could be typed.
  it("keeps a trailing space so multi-word roles can be typed", async () => {
    mockApi();
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "Senior " } });
    expect(input.value).toBe("Senior ");

    fireEvent.change(input, { target: { value: "Senior iOS developer" } });
    expect(input.value).toBe("Senior iOS developer");
  });

  it("keeps a just-typed comma so a second entry can be started", async () => {
    mockApi();
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "iOS developer," } });
    expect(input.value).toBe("iOS developer,");

    fireEvent.change(input, { target: { value: "iOS developer, " } });
    expect(input.value).toBe("iOS developer, ");

    fireEvent.change(input, { target: { value: "iOS developer, Mobile engineer" } });
    expect(input.value).toBe("iOS developer, Mobile engineer");
  });

  it("applies the same behaviour to every comma-separated field", async () => {
    mockApi();
    render(<PreferencesTab />);
    await findTargetRoles();

    for (const label of [/locations/i, /industries/i, /excluded companies/i]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "One, Two " } });
      expect(input.value).toBe("One, Two ");
    }
  });

  it("splits the text into entries only when saving", async () => {
    const onSave = vi.fn();
    mockApi({ onSave });
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "Senior iOS developer, Mobile engineer" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRoles: ["Senior iOS developer", "Mobile engineer"],
        }),
      );
    });
  });

  it("discards blank entries and surrounding whitespace on save", async () => {
    const onSave = vi.fn();
    mockApi({ onSave });
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "  iOS developer ,, , Android developer,  " } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRoles: ["iOS developer", "Android developer"],
        }),
      );
    });
  });

  it("normalizes the field once the save succeeds", async () => {
    mockApi();
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "iOS developer,,  Android developer ," } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(screen.getByText(/saved\./i)).toBeVisible();
    });
    expect(input.value).toBe("iOS developer, Android developer");
  });

  it("leaves the text untouched when the save fails, so nothing typed is lost", async () => {
    mockApi({ saveStatus: 502 });
    render(<PreferencesTab />);
    const input = await findTargetRoles();

    fireEvent.change(input, { target: { value: "iOS developer, Android developer, " } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    expect(await screen.findByText(/unable to save job preferences/i)).toBeVisible();
    expect(input.value).toBe("iOS developer, Android developer, ");
  });

  it("still saves the non-list fields", async () => {
    const onSave = vi.fn();
    mockApi({ onSave });
    render(<PreferencesTab />);
    await findTargetRoles();

    fireEvent.change(screen.getByLabelText(/remote policy/i), { target: { value: "remote" } });
    fireEvent.change(screen.getByLabelText(/minimum compensation/i), { target: { value: "85000" } });
    fireEvent.change(screen.getByLabelText(/currency/i), { target: { value: "SEK" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          remotePolicy: "remote",
          minimumCompensation: 85000,
          compensationCurrency: "SEK",
        }),
      );
    });
  });
});
