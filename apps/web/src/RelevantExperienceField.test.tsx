import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RelevantExperienceField } from "./RelevantExperienceField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fixtureFile(name: string): Promise<File> {
  const bytes = await readFile(resolve(process.cwd(), "src/__fixtures__", name));
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/**
 * Builds a minimal single-page PDF containing the given lines.
 *
 * Hand-built rather than committed as a fixture so the "nothing to redact" case
 * is visibly free of contact details in the test itself -- a binary fixture
 * would require trusting a filename.
 */
function pdfWithLines(lines: readonly string[], name = "clean.pdf"): File {
  const text = lines
    .map((line, index) => `BT /F1 12 Tf 40 ${740 - index * 18} Td (${line}) Tj ET`)
    .join("\n");
  const source = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]" +
      "/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${text.length}>>stream\n${text}\nendstream endobj`,
    "trailer<</Root 1 0 R>>",
  ].join("\n");

  return new File([new TextEncoder().encode(source)], name, { type: "application/pdf" });
}

/** Renders with the controlled value wired up, as `ProfileTab` does. */
function renderField(initial = "") {
  const onChange = vi.fn();
  let current = initial;
  const view = render(<RelevantExperienceField value={current} onChange={onChange} />);
  const rerender = () => view.rerender(<RelevantExperienceField value={current} onChange={onChange} />);
  onChange.mockImplementation((next: string) => {
    current = next;
    rerender();
  });
  return { onChange, value: () => current };
}

function chooseFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error("file input not rendered");
  }
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("RelevantExperienceField", () => {
  it("is an ordinary editable textarea before any PDF is involved", () => {
    const { onChange } = renderField("Typed by hand.");

    const textarea = screen.getByLabelText("Relevant experience");
    expect(textarea).toHaveValue("Typed by hand.");

    fireEvent.change(textarea, { target: { value: "Edited by hand." } });
    expect(onChange).toHaveBeenCalledWith("Edited by hand.");
  });

  it("populates from a PDF and redacts contact details without being asked", async () => {
    const state = renderField();

    chooseFile(await fixtureFile("resume.pdf"));

    await waitFor(() => {
      expect(state.value()).toContain("Senior iOS Engineer");
    });

    // Redaction is unconditional here -- there is no opt-out to tick, because
    // the result is reviewable in the textarea before it is saved.
    expect(state.value()).not.toContain("jane.lindqvist@example.com");
    expect(state.value()).not.toContain("Storgatan 4");
    expect(state.value()).toContain("Swift Concurrency");

    expect(screen.getByText(/Removed .*email address/i)).toBeVisible();
    expect(screen.getByText(/Check it below, then save/i)).toBeVisible();
  });

  it("pluralises what it removed correctly", async () => {
    // A naive `+ "s"` renders "2 street addresss". Nothing in the type system
    // or the schema catches that; it was found by looking at the page.
    const state = renderField();

    chooseFile(await fixtureFile("resume.pdf"));
    await waitFor(() => expect(state.value()).not.toBe(""));

    const notice = screen.getByText(/^Imported /);
    expect(notice.textContent).not.toMatch(/addresss|numbers s|linkss/);
    expect(notice.textContent).toMatch(/street address(es)?/);
  });

  it("does not save on its own -- populating only fills the field", async () => {
    // The whole reason for populate-then-review: a multi-column CV extracts as
    // interleaved nonsense and cannot be detected, so nothing may reach the
    // server without the user seeing it first.
    const state = renderField();

    chooseFile(await fixtureFile("resume.pdf"));
    await waitFor(() => expect(state.value()).not.toBe(""));

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("asks before replacing text that is already there", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderField("Something I wrote myself.");

    fireEvent.click(screen.getByRole("button", { name: "Populate from PDF" }));

    expect(confirm).toHaveBeenCalledWith(
      "Replace what is already in Relevant experience with the text from a PDF?",
    );
  });

  it("does not prompt when the field is empty", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderField("");

    fireEvent.click(screen.getByRole("button", { name: "Populate from PDF" }));

    expect(confirm).not.toHaveBeenCalled();
  });

  it("explains a scanned PDF rather than silently leaving the field empty", async () => {
    const state = renderField();

    chooseFile(await fixtureFile("blank.pdf"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/scanned or image-only/i);
    });
    expect(state.value()).toBe("");
  });

  it("reports a damaged PDF through the same alert", async () => {
    renderField();

    chooseFile(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "broken.pdf", {
      type: "application/pdf",
    }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/i);
    });
  });

  it("says so when a CV carried no contact details to remove", async () => {
    const state = renderField();

    chooseFile(
      pdfWithLines([
        "EXPERIENCE",
        "Spotify - Senior iOS Engineer 2019-2025",
        "Led the migration to Swift Concurrency.",
      ]),
    );

    await waitFor(() => {
      expect(screen.getByText(/No contact details were found to remove/i)).toBeVisible();
    });
    expect(state.value()).toContain("Swift Concurrency");
  });
});
