import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildFiles, outputDir, sourceDir } from "./build.mjs";

type Item = { id: string; fam: string; b: number; cells: string[]; options: string[]; correct: number; rule: string };
type Engine = {
  FAMILIES: string[];
  make: (family: string, seed: number, hard: boolean) => Item | null;
  fromId: (id: string) => Item;
  generate: (target: number, options?: { avoid?: string[]; rnd?: () => number }) => Item | null;
  generateForRun: (target: number, used?: string[], options?: { rnd?: () => number; tol?: number }) => Item | null;
  predict: (grid: number[][], options?: { mod?: number; ordinal?: boolean; arith?: boolean }) => Set<number>;
  hooks: { onFinish?: (built: { fam: string; ans: Record<string, unknown>; options: Record<string, unknown>[]; preds?: { key: string; answer: unknown; values: unknown[] }[]; cells?: Record<string, unknown>[]; rule?: string }) => void };
};

// Deterministic Math.random replacement (mulberry32) so run simulations are not flaky.
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Generator sweeps take ~1s locally but several seconds on slower CI runners.
const SWEEP_TIMEOUT = 30_000;

describe("logic trainer engine", { timeout: SWEEP_TIMEOUT }, () => {
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

  it("lets every family reach both easy and hard items", () => {
    for (const family of ENGINE.FAMILIES) {
      let min = Infinity;
      let max = -Infinity;
      for (let seed = 1; seed <= 150; seed++) {
        for (const hard of [false, true]) {
          const item = ENGINE.make(family, seed, hard);
          if (!item) continue;
          expectWellFormed(item);
          min = Math.min(min, item.b);
          max = Math.max(max, item.b);
        }
      }
      expect(min, `${family} has no easy items`).toBeLessThanOrEqual(-1.2);
      expect(max, `${family} has no hard items`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("rates watch faces with changing turn steps above simple constant turns", () => {
    const variable: Item[] = [];
    const simple: Item[] = [];
    for (let seed = 1; seed <= 150; seed++) {
      const item = ENGINE.make("dial", seed, true);
      if (!item) continue;
      expectWellFormed(item);
      if (/doubles along every row|grows with the row/.test(item.rule)) variable.push(item);
      // Two hands with small constant turns (at most 90°) plus a two-and-one face colour.
      const steps = [...item.rule.matchAll(/turns (\d+)° (?:anti)?clockwise each column/g)].map((m) => Number(m[1]));
      if (steps.length === 2 && steps.every((s) => s <= 90) && /clock face colour/.test(item.rule)) simple.push(item);
    }
    expect(variable.length).toBeGreaterThan(10);
    expect(simple.length).toBeGreaterThan(3);
    for (const item of variable) expect(item.b, item.rule).toBeGreaterThanOrEqual(1.0);
    for (const item of simple) expect(item.b, item.rule).toBeLessThan(1.75);
  });

  describe("answer integrity", () => {
    type Built = { fam: string; ans: Record<string, unknown>; options: Record<string, unknown>[]; preds?: { key: string; answer: unknown; values: unknown[] }[]; cells?: Record<string, unknown>[]; rule?: string };
    const built: Built[] = [];
    const key = (v: unknown) => JSON.stringify(v);

    beforeAll(() => {
      ENGINE.hooks.onFinish = (b) => built.push(b);
      for (const fam of ENGINE.FAMILIES) for (const hard of [false, true]) for (let seed = 1; seed <= 200; seed++) ENGINE.make(fam, seed, hard);
      delete ENGINE.hooks.onFinish;
    }, SWEEP_TIMEOUT);

    it("sees items from every family", () => {
      expect(new Set(built.map((b) => b.fam))).toEqual(new Set(ENGINE.FAMILIES));
      // Some items test three rules at once, so the three-rule option layout is covered too.
      const tested = (b: Built) => Object.keys(b.ans).filter((k) => new Set(b.options.map((o) => key(o[k]))).size > 1).length;
      expect(built.some((b) => tested(b) >= 3)).toBe(true);
    });

    it("never makes the answer the most common value of any attribute among the options", () => {
      for (const b of built) {
        for (const k of Object.keys(b.ans)) {
          const counts = new Map<string, number>();
          for (const o of b.options) counts.set(key(o[k]), (counts.get(key(o[k])) ?? 0) + 1);
          const answerCount = counts.get(key(b.ans[k])) ?? 0;
          const others = [...counts].filter(([v]) => v !== key(b.ans[k])).map(([, n]) => n);
          if (others.length) expect(answerCount, `${b.fam}.${k}`).toBeLessThanOrEqual(Math.max(...others));
        }
      }
    });

    it("lets every rule lead to exactly one value, the answer's", () => {
      const checked = built.filter((b) => b.preds);
      expect(checked.length).toBeGreaterThan(1000);
      for (const b of checked) for (const p of b.preds ?? []) expect(p.values.map(key), `${b.fam}.${p.key}`).toEqual([key(p.answer)]);
    });

    it("does not let dots in neighbouring quadrants cancel to a different answer", () => {
      // Quadrant dot items store p (+ one quadrant, - the opposite) and q (the other diagonal). Cancelling neighbouring
      // quadrants instead (e.g. top-left against top-right) must never also explain rows 1-2 yet predict another figure.
      const quadItems = built.filter((b) => b.fam === "sides" && /quadrant/.test(b.rule ?? ""));
      expect(quadItems.length).toBeGreaterThan(50);
      for (const b of quadItems) {
        const grid = [...(b.cells ?? []), b.ans].map((c) => {
          const p = c.p as number, q = c.q as number;
          return [Math.max(q, 0), Math.max(-p, 0), Math.max(-q, 0), Math.max(p, 0)];
        });
        const at = (r: number, c: number, transpose: boolean) => grid[transpose ? c * 3 + r : r * 3 + c] ?? [];
        for (const pairs of [[[0, 1], [2, 3]], [[0, 3], [1, 2]]]) {
          for (const transpose of [false, true]) {
            const net = (r: number, c: number, [i, j]: number[]) => (at(r, c, transpose)[i ?? 0] ?? 0) - (at(r, c, transpose)[j ?? 0] ?? 0);
            const fits = pairs.every((pair) => [0, 1].every((r) => net(r, 0, pair) + net(r, 1, pair) === net(r, 2, pair)));
            if (!fits) continue;
            const rival = [0, 0, 0, 0];
            for (const [i = 0, j = 0] of pairs) {
              const n = net(2, 0, [i, j]) + net(2, 1, [i, j]);
              rival[i] = Math.max(n, 0);
              rival[j] = Math.max(-n, 0);
            }
            expect(rival, b.rule).toEqual(grid[8]);
          }
        }
      }
    });

    it("recognises both readings of an ambiguous number grid", () => {
      // 1+2=3 and 2+1=3 fit addition (answer 4), but each row is also a permutation of 1,2,3 (answer 2).
      const grid = [[1, 2, 3], [2, 1, 3], [3, 1, 0]];
      expect([...ENGINE.predict(grid, { ordinal: true, arith: true })].sort()).toEqual([2, 4]);
    });
  });
});

describe("logic trainer run generation", { timeout: SWEEP_TIMEOUT }, () => {
  it.each([0.5, 1.5])("spreads families over a 20-question run at difficulty %s", (target) => {
    const rnd = seededRandom(Math.round(target * 1000) + 7);
    const used: string[] = [];
    for (let i = 0; i < 20; i++) {
      const item = ENGINE.generateForRun(target, used, { rnd });
      expect(item).not.toBeNull();
      expectWellFormed(item!);
      expect(Math.abs(item!.b - target)).toBeLessThanOrEqual(0.5);
      expect(used.slice(-3), `${item!.fam} repeated within 4 questions`).not.toContain(item!.fam);
      used.push(item!.fam);
    }
    const counts = Object.values(used.reduce<Record<string, number>>((c, f) => ({ ...c, [f]: (c[f] ?? 0) + 1 }), {}));
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(counts).toHaveLength(ENGINE.FAMILIES.length);
  });

  it("still returns an item when every family is used up", () => {
    const rnd = seededRandom(42);
    const twice = [...ENGINE.FAMILIES, ...ENGINE.FAMILIES];
    const fourTimes = [...twice, ...twice];
    for (const used of [twice, fourTimes]) {
      const item = ENGINE.generateForRun(1, used, { rnd });
      expect(item).not.toBeNull();
      expectWellFormed(item!);
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
