import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  applicationDetailPath,
  isApplicationDetailRoute,
  isApplicationsRoute,
  useOpportunityRoute,
} from "./routing";

function TestHarness() {
  const { selectedApplicationId, openApplication, closeApplication } = useOpportunityRoute();
  return (
    <div>
      <p>selected: {selectedApplicationId ?? "none"}</p>
      <button onClick={() => openApplication("app-42")}>open</button>
      <button onClick={closeApplication}>close</button>
    </div>
  );
}

describe("applicationDetailPath", () => {
  it("builds an encoded /applications/:id path", () => {
    expect(applicationDetailPath("abc 123")).toBe("/applications/abc%20123");
  });
});

describe("isApplicationDetailRoute", () => {
  it("recognizes a detail path", () => {
    expect(isApplicationDetailRoute("/applications/abc-123")).toBe(true);
  });

  describe("isApplicationsRoute", () => {
    it("recognizes both the board and opportunity detail paths", () => {
      expect(isApplicationsRoute("/applications")).toBe(true);
      expect(isApplicationsRoute("/applications/abc-123")).toBe(true);
      expect(isApplicationsRoute("/")).toBe(false);
    });
  });

  it("rejects the bare applications list path and other paths", () => {
    expect(isApplicationDetailRoute("/applications")).toBe(false);
    expect(isApplicationDetailRoute("/")).toBe(false);
  });
});

describe("useOpportunityRoute", () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  it("starts with no selection when the URL has no application id", () => {
    window.history.pushState({}, "", "/");
    render(<TestHarness />);
    expect(screen.getByText("selected: none")).toBeVisible();
  });

  it("reads the initial selection from a deep-linked URL", () => {
    window.history.pushState({}, "", "/applications/app-7");
    render(<TestHarness />);
    expect(screen.getByText("selected: app-7")).toBeVisible();
  });

  it("updates the URL and selection when opening and closing an application", () => {
    window.history.pushState({}, "", "/");
    render(<TestHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("selected: app-42")).toBeVisible();
    expect(window.location.pathname).toBe("/applications/app-42");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByText("selected: none")).toBeVisible();
    expect(window.location.pathname).toBe("/applications");
  });

  it("responds to browser back/forward navigation", () => {
    window.history.pushState({}, "", "/");
    render(<TestHarness />);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("selected: app-42")).toBeVisible();

    window.history.pushState({}, "", "/");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByText("selected: none")).toBeVisible();
  });
});
