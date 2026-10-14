import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFiles, outputDir, sourceDir } from "./build.mjs";

type Item = { id: string; fam: string; b: number; cells: string[]; options: string[]; correct: number; rule: string };
type Engine = {
  FAMILIES: string[];
  make: (family: string, seed: number, hard: boolean) => Item | null;
  fromId: (id: string) => Item;
  generate: (target: number, options?: { avoid?: string[] }) => Item | null;
};

const ENGINE = new Function(`${readFileSync(join(sourceDir, "engine.js"), "utf8")}\nreturn ENGINE;`)() as Engine;

function expectWellFormed(item: Item) {
  expect(item.cells).toHaveLength(8);
  expect(item.options).toHaveLength(6);
  expect(new Set(item.options).size).toBe(6);
  expect(item.correct).toBeGreaterThanOrEqual(0);
  expect(item.correct).toBeLessThan(6);
  expect(item.b).toBeGreaterThanOrEqual(-2.6);
  expect(item.b).toBeLessThanOrEqual(3.2);
  expect(item.rule.length).toBeGreaterThan(0);
}

describe("logic trainer build", () => {
  it("has committed output that matches the sources", () => {
    for (const [name, contents] of Object.entries(buildFiles())) {
      expect(readFileSync(join(outputDir, name), "utf8"), `${name} is stale; run npm run build:logic-trainer`).toBe(contents);
    }
  });

  it("produces output the site's Content-Security-Policy allows", () => {
    const files = buildFiles();
    const html = files["index.html"] ?? "";
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    for (const contents of Object.values(files)) {
      expect(contents).not.toMatch(/\sstyle="/i);
      expect(contents).not.toMatch(/\son[a-z]+="/i);
    }
  });
});

describe("logic trainer engine", () => {
  it("generates well-formed items in every family", () => {
    for (const family of ENGINE.FAMILIES) {
      let made = 0;
      for (let seed = 1; seed <= 60 && made < 5; seed++) {
        for (const hard of [false, true]) {
          const item = ENGINE.make(family, seed, hard);
          if (!item) continue;
          made++;
          expect(item.fam).toBe(family);
          expectWellFormed(item);
        }
      }
      expect(made, `no items generated for ${family}`).toBeGreaterThan(0);
    }
  });

  it("rebuilds the same item from its id", () => {
    const item = ENGINE.generate(1.5);
    expect(item).not.toBeNull();
    const again = ENGINE.fromId(item!.id);
    expect(again.options).toEqual(item!.options);
    expect(again.correct).toBe(item!.correct);
  });

  it("covers the full difficulty range used by the app", () => {
    for (const target of [-2.2, 0, 3.0]) {
      const item = ENGINE.generate(target);
      expect(item).not.toBeNull();
      expectWellFormed(item!);
      expect(Math.abs(item!.b - target)).toBeLessThan(0.8);
    }
  });
});

const KEY = "logicTrainer.v1";
const HIST = "logicTrainer.history.v1";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}
const localStorage = new MemoryStorage();

// Boots the built page script into the test's jsdom document, the way the browser loads it.
function boot(storage: Record<string, unknown> = {}) {
  const files = buildFiles();
  const body = /<body>([\s\S]*)<\/body>/.exec(files["index.html"] ?? "")?.[1] ?? "";
  document.body.innerHTML = body;
  localStorage.clear();
  for (const [key, value] of Object.entries(storage)) {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  new Function("localStorage", files["trainer.js"] ?? "")(localStorage);
}
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown>;
const options = () => [...document.querySelectorAll<HTMLButtonElement>("#app button.opt")];

function timedState(overrides: Record<string, unknown>) {
  return { screen: "timed", src: "new", order: [], resp: [], ans: [], times: [], sel: null,
    cur: ENGINE.generate(0)!.id, remaining: 120, paused: false, ...overrides };
}

describe("logic trainer page", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("parses and boots to the home screen", () => {
    vi.useFakeTimers();
    boot();
    expect(document.getElementById("start-t")).not.toBeNull();
  });

  it("falls back to the home screen when saved state is corrupt or incomplete", () => {
    vi.useFakeTimers();
    const broken = [
      "not json",
      { screen: "timed" },
      { screen: "result", order: [1], resp: [1], ans: [0], times: [5], src: "new" },
      { screen: "practice", set: "gen", diff: "hard", list: ["n:nope:1"], idx: 0, sel: null, result: null },
      { ...timedState({ order: [1], resp: [1], ans: [0], times: [3] }), screen: "review", est: { theta: 0, sd: 1 }, rev: 4 },
      { screen: "constructor" },
    ];
    for (const state of broken) {
      boot({ [KEY]: state });
      expect(document.getElementById("start-t"), JSON.stringify(state)).not.toBeNull();
    }

    boot({ [KEY]: { ...timedState({ order: [1], resp: [1], ans: [0], times: [3] }), screen: "review", est: { theta: 0, sd: 1 }, rev: 0 } });
    expect(document.getElementById("b-back"), "a valid saved review screen is restored").not.toBeNull();
  });

  it("drops malformed history entries instead of rendering them", () => {
    vi.useFakeTimers();
    const valid = { date: Date.now(), src: "new", theta: 0.5, sd: 0.4, n: 20, correct: 14, time: 900 };
    boot({ [HIST]: [valid, { ...valid, correct: '<img id="injected" src="x">' }, { ...valid, theta: "1" }, null] });
    expect(document.getElementById("injected")).toBeNull();
    expect(document.querySelectorAll("#app table tr")).toHaveLength(2);
  });

  it("renders answer options as labelled toggle buttons", () => {
    vi.useFakeTimers();
    boot();
    document.getElementById("start-t")!.click();
    expect(options().map(o => o.getAttribute("aria-label"))).toEqual(["A", "B", "C", "D", "E", "F"].map(l => `Option ${l}`));
    options()[2]!.focus();
    options()[2]!.click();
    expect(options().map(o => o.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false"]);
    expect(document.activeElement).toBe(options()[2]);
  });

  it("derives the question clock from a wall-clock deadline", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    boot({ [KEY]: timedState({ deadline: 1_000_000 + 45_000 }) });
    expect(document.getElementById("clock")!.textContent).toBe("0:45");

    // A throttled background tab may fire the interval only once; the elapsed time still counts in full.
    vi.setSystemTime(1_000_000 + 46_000);
    vi.advanceTimersByTime(250);
    expect(saved()).toMatchObject({ screen: "timed", resp: [0], ans: [null], times: [120] });
  });

  it("does not run the clock while paused", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    boot({ [KEY]: timedState({ paused: true, remaining: 30, deadline: null }) });
    vi.setSystemTime(1_000_000 + 600_000);
    vi.advanceTimersByTime(1_000);
    expect(saved()).toMatchObject({ order: [], remaining: 30, paused: true });
  });
});
