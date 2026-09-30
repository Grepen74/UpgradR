import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FitText, fitScale, MIN_FIT_SCALE } from "./FitText";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom has no layout, so widths are stubbed on the prototype. */
function stubWidths(available: number, needed: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(available);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(needed);
}

describe("fitScale", () => {
  it("leaves content that already fits at full size", () => {
    expect(fitScale(200, 200)).toBe(1);
    expect(fitScale(200, 120)).toBe(1);
  });

  it("shrinks overflowing content just enough to fit, never rounding up past it", () => {
    expect(fitScale(200, 250)).toBe(0.8);
    expect(fitScale(200, 230)).toBe(0.86);
  });

  it("never shrinks below the minimum scale", () => {
    expect(fitScale(200, 1000)).toBe(MIN_FIT_SCALE);
  });

  it("does nothing before the element has been laid out", () => {
    expect(fitScale(0, 300)).toBe(1);
  });
});

describe("FitText", () => {
  it("renders a title that fits unchanged", () => {
    stubWidths(200, 150);
    render(<FitText text="Senior engineer" />);
    const title = screen.getByText("Senior engineer");
    expect(title.style.getPropertyValue("--fit-scale")).toBe("1");
    expect(title).not.toHaveAttribute("data-fit");
    expect(title).not.toHaveAttribute("title");
  });

  it("shrinks a long unbreakable title that fits at the reduced size", () => {
    stubWidths(200, 250);
    render(<FitText text="averylongnamewithoutspaces" />);
    const title = screen.getByText("averylongnamewithoutspaces");
    expect(title.style.getPropertyValue("--fit-scale")).toBe("0.8");
    expect(title).not.toHaveAttribute("data-fit");
  });

  it("truncates at the minimum scale and exposes the full title on hover", () => {
    stubWidths(200, 400);
    const text = "averylongnamewithoutanywhitespaceatallreally";
    render(<FitText text={text} className="extra" />);
    const title = screen.getByText(text);
    expect(title.style.getPropertyValue("--fit-scale")).toBe(String(MIN_FIT_SCALE));
    expect(title).toHaveAttribute("data-fit", "truncated");
    expect(title).toHaveAttribute("title", text);
    expect(title).toHaveClass("fit-text", "extra");
  });
});
