import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsentPage } from "./ConsentPage";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : ((input as Request).url ?? String(input));
}

const CATALOG = [
  {
    scope: "mcp",
    label: "Connect as an agent",
    description: "Required.",
    recommended: true,
    sensitive: false,
    required: true,
  },
  {
    scope: "profile:read",
    label: "Read your career profile",
    description: "Confirmed experience and skills.",
    recommended: true,
    sensitive: false,
    required: false,
  },
  {
    scope: "applications:write",
    label: "Add and update opportunities",
    description: "Create proposals in your Inbox.",
    recommended: false,
    sensitive: false,
    required: false,
  },
  {
    scope: "applications:delete",
    label: "Delete opportunities and notes",
    description: "Permanently remove items.",
    recommended: false,
    sensitive: true,
    required: false,
  },
];

const AUTHORIZATION = {
  authorizationId: "auth-1",
  client: { name: "Example Agent", redirectUri: "https://agent.example/callback" },
  scopes: ["openid"],
  scopeCatalog: CATALOG,
  defaultScopes: ["mcp", "profile:read"],
};

function mockAuthorization(decision?: (body: unknown) => void) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/oauth/authorization")) {
      return new Response(JSON.stringify(AUTHORIZATION), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/oauth/decision")) {
      decision?.(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ redirectUrl: "https://agent.example/done" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

describe("ConsentPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pre-selects the recommended scopes and leaves the rest off", async () => {
    mockAuthorization();
    render(<ConsentPage authorizationId="auth-1" />);

    const profile = (await screen.findByLabelText(/read your career profile/i)) as HTMLInputElement;
    const write = screen.getByLabelText(/add and update opportunities/i) as HTMLInputElement;
    const remove = screen.getByLabelText(/delete opportunities and notes/i) as HTMLInputElement;

    expect(profile.checked).toBe(true);
    expect(write.checked).toBe(false);
    expect(remove.checked).toBe(false);
  });

  it("locks the required gate scope on so it cannot be deselected", async () => {
    mockAuthorization();
    render(<ConsentPage authorizationId="auth-1" />);

    const gate = (await screen.findByLabelText(/connect as an agent/i)) as HTMLInputElement;
    expect(gate.checked).toBe(true);
    expect(gate.disabled).toBe(true);
  });

  it("marks a sensitive scope so deletion is a deliberate choice", async () => {
    mockAuthorization();
    render(<ConsentPage authorizationId="auth-1" />);

    await screen.findByLabelText(/delete opportunities and notes/i);
    expect(screen.getByText(/sensitive/i)).toBeVisible();
  });

  it("sends exactly the scopes the user selected when approving", async () => {
    const body = vi.fn();
    mockAuthorization(body);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(<ConsentPage authorizationId="auth-1" />);

    fireEvent.click(await screen.findByLabelText(/add and update opportunities/i));
    fireEvent.click(screen.getByLabelText(/read your career profile/i));
    fireEvent.click(screen.getByRole("button", { name: /approve access/i }));

    await waitFor(() => {
      expect(body).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationId: "auth-1",
          decision: "approve",
          scopes: ["mcp", "applications:write"],
        }),
      );
    });
    expect(assign).toHaveBeenCalledWith("https://agent.example/done");
  });

  it("denies without granting anything", async () => {
    const body = vi.fn();
    mockAuthorization(body);
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });

    render(<ConsentPage authorizationId="auth-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /^deny$/i }));

    await waitFor(() => {
      expect(body).toHaveBeenCalledWith(expect.objectContaining({ decision: "deny" }));
    });
  });

  it("shows the requesting client and redirect so the user can spot an impostor", async () => {
    mockAuthorization();
    render(<ConsentPage authorizationId="auth-1" />);

    expect(await screen.findByText("https://agent.example/callback")).toBeVisible();
    expect(screen.getByRole("heading", { name: /authorize example agent/i })).toBeVisible();
  });

  it("reports an expired or invalid authorization instead of rendering a picker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid or expired authorization request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ConsentPage authorizationId="auth-1" />);

    expect(await screen.findByText(/invalid or expired authorization request/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /approve access/i })).toBeNull();
  });
});
