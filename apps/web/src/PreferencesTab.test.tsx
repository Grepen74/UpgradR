import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { JobSearchPreferences } from "./api";
import { PreferencesTab } from "./PreferencesTab";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : ((input as Request).url ?? String(input));
}

const LOADED: JobSearchPreferences = {
  targetRoles: ["iOS developer"],
  locations: [],
  remotePolicy: "flexible",
  minimumCompensation: null,
  minimumCompensationPeriod: "month",
  compensationCurrency: null,
  industries: [],
  excludedCompanies: [],
  notes: null,
  minimumMatchScore: null,
};

function mockApi(
  options: { onSave?: (body: unknown) => void; saveStatus?: number; loaded?: JobSearchPreferences } = {},
) {
  const loaded = options.loaded ?? LOADED;
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
      return new Response(JSON.stringify(loaded), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/preferences")) {
      return new Response(JSON.stringify(loaded), {
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
    fireEvent.change(screen.getByLabelText(/compensation period/i), { target: { value: "year" } });
    fireEvent.change(screen.getByLabelText(/^currency/i), { target: { value: "SEK" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          remotePolicy: "remote",
          minimumCompensation: 85000,
          minimumCompensationPeriod: "year",
          compensationCurrency: "SEK",
        }),
      );
    });
  });

  describe("minimum match score floor", () => {
    function scoreToggle() {
      return screen.getByLabelText(/only propose matches scoring/i) as HTMLInputElement;
    }

    function scoreSlider() {
      return screen.getByLabelText(/^minimum match score$/i) as HTMLInputElement;
    }

    it("loads disabled with the slider disabled, matching an unset floor", async () => {
      mockApi();
      render(<PreferencesTab />);
      await findTargetRoles();

      expect(scoreToggle().checked).toBe(false);
      expect(scoreSlider().disabled).toBe(true);
    });

    it("loads enabled with the stored value when a floor is already set", async () => {
      mockApi({ loaded: { ...LOADED, minimumMatchScore: 75 } });
      render(<PreferencesTab />);
      await findTargetRoles();

      expect(scoreToggle().checked).toBe(true);
      expect(scoreSlider().disabled).toBe(false);
      expect(scoreSlider().value).toBe("75");
    });

    it("enabling the floor sends a default value; disabling sends null", async () => {
      const onSave = vi.fn();
      mockApi({ onSave });
      render(<PreferencesTab />);
      await findTargetRoles();

      fireEvent.click(scoreToggle());
      fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
      await waitFor(() => {
        expect(onSave).toHaveBeenLastCalledWith(
          expect.objectContaining({ minimumMatchScore: expect.any(Number) }),
        );
      });
      expect(onSave.mock.calls.at(-1)?.[0].minimumMatchScore).not.toBeNull();

      fireEvent.click(scoreToggle());
      fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
      await waitFor(() => {
        expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ minimumMatchScore: null }));
      });
    });

    it("saves the value the slider is moved to", async () => {
      const onSave = vi.fn();
      mockApi({ onSave });
      render(<PreferencesTab />);
      await findTargetRoles();

      fireEvent.click(scoreToggle());
      fireEvent.change(scoreSlider(), { target: { value: "85" } });
      fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ minimumMatchScore: 85 }));
      });
    });

    // Disabling stores null in the form, but toggling back on before saving
    // must restore the drafted value rather than resetting to the default --
    // otherwise an accidental double-click on the toggle silently discards
    // whatever the user had dialed in.
    it("restores the drafted value when re-enabled before saving", async () => {
      const onSave = vi.fn();
      mockApi({ onSave });
      render(<PreferencesTab />);
      await findTargetRoles();

      fireEvent.click(scoreToggle());
      fireEvent.change(scoreSlider(), { target: { value: "85" } });
      fireEvent.click(scoreToggle());
      expect(scoreSlider().disabled).toBe(true);
      fireEvent.click(scoreToggle());
      expect(scoreSlider().value).toBe("85");

      fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ minimumMatchScore: 85 }));
      });
    });
  });
});
