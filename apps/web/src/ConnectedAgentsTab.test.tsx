import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectedAgentsTab } from "./ConnectedAgentsTab";

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
];

const CLIENT_ID = "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b";

function grantsResponse(scopes: string[]) {
  return {
    grants: [
      {
        clientId: CLIENT_ID,
        clientName: "Example Agent",
        scopes,
        grantedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    scopeCatalog: CATALOG,
  };
}

function mockApi(options: {
  onUpdate?: (body: unknown) => void;
  onRevoke?: (body: unknown) => void;
  updateStatus?: number;
  scopesAfterUpdate?: string[];
}) {
  let scopes = ["mcp", "profile:read"];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/oauth/grants/scopes")) {
      options.onUpdate?.(JSON.parse(String(init?.body)));
      if (options.updateStatus && options.updateStatus >= 400) {
        return new Response(JSON.stringify({ error: "That agent is not connected" }), {
          status: options.updateStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      scopes = options.scopesAfterUpdate ?? scopes;
      return new Response(JSON.stringify({ scopes }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/oauth/grants/revoke")) {
      options.onRevoke?.(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ revoked: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/oauth/grants")) {
      return new Response(JSON.stringify(grantsResponse(scopes)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
}

describe("ConnectedAgentsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("summarizes each grant with readable labels rather than raw scope strings", async () => {
    mockApi({});
    render(<ConnectedAgentsTab />);

    expect(await screen.findByText("Example Agent")).toBeVisible();
    const summary = screen.getByLabelText(/granted permissions/i);
    expect(summary).toHaveTextContent("Read your career profile");
    expect(summary).not.toHaveTextContent("profile:read");
  });

  it("opens an editor pre-filled with the scopes the agent currently holds", async () => {
    mockApi({});
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /edit permissions/i }));

    expect((screen.getByLabelText(/read your career profile/i) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText(/add and update opportunities/i) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("saves a widened selection and refreshes the summary", async () => {
    const onUpdate = vi.fn();
    mockApi({ onUpdate, scopesAfterUpdate: ["mcp", "profile:read", "applications:write"] });
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /edit permissions/i }));
    fireEvent.click(screen.getByLabelText(/add and update opportunities/i));
    fireEvent.click(screen.getByRole("button", { name: /save permissions/i }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({
        clientId: CLIENT_ID,
        scopes: ["mcp", "profile:read", "applications:write"],
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/granted permissions/i)).toHaveTextContent(
        "Add and update opportunities",
      );
    });
  });

  it("saves a narrowed selection, so access can be tightened without disconnecting", async () => {
    const onUpdate = vi.fn();
    mockApi({ onUpdate, scopesAfterUpdate: ["mcp"] });
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /edit permissions/i }));
    fireEvent.click(screen.getByLabelText(/read your career profile/i));
    fireEvent.click(screen.getByRole("button", { name: /save permissions/i }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith({ clientId: CLIENT_ID, scopes: ["mcp"] });
    });
  });

  it("discards edits when cancelled", async () => {
    const onUpdate = vi.fn();
    mockApi({ onUpdate });
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /edit permissions/i }));
    fireEvent.click(screen.getByLabelText(/add and update opportunities/i));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onUpdate).not.toHaveBeenCalled();
    const summary = screen.getByLabelText(/granted permissions/i);
    expect(summary).not.toHaveTextContent("Add and update opportunities");
  });

  it("surfaces a failed update instead of showing the change as saved", async () => {
    mockApi({ updateStatus: 404 });
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /edit permissions/i }));
    fireEvent.click(screen.getByLabelText(/add and update opportunities/i));
    fireEvent.click(screen.getByRole("button", { name: /save permissions/i }));

    expect(await screen.findByText(/that agent is not connected/i)).toBeVisible();
  });

  it("requires a confirmation before revoking access", async () => {
    const onRevoke = vi.fn();
    mockApi({ onRevoke });
    render(<ConnectedAgentsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /revoke access/i }));
    expect(onRevoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm revoke access/i }));
    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith({ clientId: CLIENT_ID });
    });
  });

  it("explains the empty state when no agent is connected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ grants: [], scopeCatalog: CATALOG }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<ConnectedAgentsTab />);
    expect(await screen.findByText(/no connected agents/i)).toBeVisible();
  });
});
