import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
