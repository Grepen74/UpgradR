import { afterEach, describe, expect, it, vi } from "vitest";

import { UpstreamError } from "../http/errors";
import { createSupabaseRestClient } from "./rest-client";
import { eqFilter } from "./query";

const config = {
  baseUrl: "https://project.supabase.co",
  anonKey: "anon-key",
  accessToken: "user-access-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSupabaseRestClient.get", () => {
  it("forwards the user's access token and apikey, never a service-role key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "1" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    await client.get("applications", { select: "id", filters: { id: eqFilter("1") } });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://project.supabase.co/rest/v1/applications?select=id&id=eq.1",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("anon-key");
    expect(headers.Authorization).toBe("Bearer user-access-token");
  });

  it("requests a single object when single is set", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    await client.get("applications", { single: true });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/vnd.pgrst.object+json");
  });

  it("throws UpstreamError with the response status on failure, without leaking the body", async () => {
    const fetchMock = vi.fn(
      async () => new Response("relation \"applications\" does not exist", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const client = createSupabaseRestClient(config);
    await expect(client.get("applications")).rejects.toThrow(UpstreamError);
    await expect(client.get("applications")).rejects.toMatchObject({ status: 404 });
  });

  it("never logs the raw response body, even when it contains literal row data", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "23505",
            message: "duplicate key value violates unique constraint",
            details: "Key (email)=(user@example.com) already exists.",
            hint: null,
          }),
          { status: 409 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const client = createSupabaseRestClient(config);
    await expect(client.get("applications")).rejects.toThrow(UpstreamError);

    expect(errorSpy).toHaveBeenCalledOnce();
    const loggedPayload = JSON.stringify(errorSpy.mock.calls[0]);
    expect(loggedPayload).not.toContain("user@example.com");
    expect(loggedPayload).toContain("23505");
  });

  it("logs a generic code when the error body is not parseable JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const client = createSupabaseRestClient(config);
    await expect(client.get("applications")).rejects.toThrow(UpstreamError);

    const loggedPayload = JSON.stringify(errorSpy.mock.calls[0]);
    expect(loggedPayload).not.toContain("Bad Gateway");
    expect(loggedPayload).toContain("unknown");
  });

  it("clamps limit and offset before sending the request", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    await client.get("applications", { limit: 9999, offset: -5 });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("0");
  });
});

describe("createSupabaseRestClient.insert", () => {
  it("POSTs the body and requests representation back by default", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "1" }]), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    const result = await client.insert("applications", { title: "Engineer" });

    expect(result).toEqual([{ id: "1" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://project.supabase.co/rest/v1/applications");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "Engineer" }));
    const headers = init.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=representation");
  });

  it("requests a single object and skips the body when returning is false", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    const result = await client.insert("notes", { body: "hi" }, { returning: false });

    expect(result).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=minimal");
  });
});

describe("createSupabaseRestClient.update", () => {
  it("PATCHes with the filters applied as query params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", is_completed: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    const result = await client.update(
      "tasks",
      { id: eqFilter("1") },
      { is_completed: true },
      { single: true },
    );

    expect(result).toEqual({ id: "1", is_completed: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://project.supabase.co/rest/v1/tasks?id=eq.1");
    expect(init.method).toBe("PATCH");
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/vnd.pgrst.object+json");
  });
});

describe("createSupabaseRestClient.remove", () => {
  it("DELETEs rows matching the filters", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    await client.remove("notes", { id: eqFilter("1") });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://project.supabase.co/rest/v1/notes?id=eq.1");
    expect(init.method).toBe("DELETE");
  });

  it("refuses a filter-less delete rather than risk deleting every visible row", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    await expect(client.remove("notes", {})).rejects.toThrow(/at least one filter/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createSupabaseRestClient.count", () => {
  it("issues a HEAD request and parses the count from Content-Range", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200, headers: { "content-range": "*/42" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    const total = await client.count("applications", { current_status: eqFilter("proposed") });

    expect(total).toBe(42);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("HEAD");
    const headers = init.headers as Record<string, string>;
    expect(headers.Prefer).toBe("count=exact");
  });

  it("returns 0 when Content-Range is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    expect(await client.count("applications")).toBe(0);
  });
});

describe("createSupabaseRestClient.rpc", () => {
  it("POSTs JSON to the rpc path with the user's bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createSupabaseRestClient(config);
    const result = await client.rpc("transition_application_status", {
      p_application_id: "1",
      p_new_status: "applied",
      p_note: null,
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://project.supabase.co/rest/v1/rpc/transition_application_status");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ p_application_id: "1", p_new_status: "applied", p_note: null }));
  });
});
