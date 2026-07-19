import { describe, expect, it } from "vitest";
import { advise, type AdviseInput } from "../src/advise.js";
import type { Categories } from "../src/attribute.js";
import type { CacheAnalysis } from "../src/cost/cache.js";

function categories(over: Partial<Categories> = {}): Categories {
  return {
    generationUSD: 1,
    fileReadsUSD: 0,
    toolResultsUSD: 0,
    overheadUSD: 0,
    cacheWritesUSD: 0,
    compactionUSD: 0,
    ...over,
  };
}

function cache(over: Partial<CacheAnalysis> = {}): CacheAnalysis {
  return {
    hitRate: 0.9,
    savedUSD: 5,
    wastedUSD: 0,
    invalidations: 0,
    tokens: { read: 900, write: 50, uncached: 50 },
    ...over,
  };
}

function input(over: Partial<AdviseInput> = {}): AdviseInput {
  return { totalUSD: 10, categories: categories(), cache: cache(), compactionEventCount: 0, ...over };
}

describe("advise", () => {
  it("healthy project yields only ok findings and zero savings", () => {
    const a = advise(input());
    expect(a.findings.every((f) => f.severity === "ok")).toBe(true);
    expect(a.potentialSavingsUSD).toBe(0);
  });

  it("flags cache prefix breaks with wasted dollars as savings", () => {
    const a = advise(input({ cache: cache({ invalidations: 3, wastedUSD: 9.4 }) }));
    const f = a.findings.find((x) => x.title.includes("prefix break"));
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("3 cache prefix breaks");
    expect(f?.title).toContain("$9.40");
    expect(a.potentialSavingsUSD).toBeCloseTo(9.4);
  });

  it("skips prefix-break finding when waste is immaterial", () => {
    const a = advise(input({ cache: cache({ invalidations: 1, wastedUSD: 0.01 }) }));
    expect(a.findings.find((x) => x.title.includes("prefix break"))).toBeUndefined();
  });

  it("flags file reads at or above 30% of spend", () => {
    const a = advise(input({ totalUSD: 10, categories: categories({ fileReadsUSD: 3 }) }));
    const f = a.findings.find((x) => x.title.includes("file reads"));
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("30%");
    expect(a.potentialSavingsUSD).toBeCloseTo(0.75);
  });

  it("does not flag file reads below 30%", () => {
    const a = advise(input({ totalUSD: 10, categories: categories({ fileReadsUSD: 2.9 }) }));
    expect(a.findings.find((x) => x.title.includes("file reads"))).toBeUndefined();
  });

  it("flags compaction at or above 10% of spend, counting events", () => {
    const a = advise(
      input({
        totalUSD: 10,
        categories: categories({ compactionUSD: 1.5 }),
        compactionEventCount: 2,
      }),
    );
    const f = a.findings.find((x) => x.title.includes("compaction"));
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("2 events");
    expect(a.potentialSavingsUSD).toBeCloseTo(1.5);
  });

  it("flags low cache hit rate without adding savings", () => {
    const a = advise(input({ cache: cache({ hitRate: 0.3 }) }));
    const f = a.findings.find((x) => x.title.includes("hit rate"));
    expect(f?.severity).toBe("warn");
    expect(f?.savingsUSD).toBeUndefined();
  });

  it("sums savings across findings", () => {
    const a = advise(
      input({
        totalUSD: 10,
        categories: categories({ fileReadsUSD: 4, compactionUSD: 2 }),
        cache: cache({ invalidations: 1, wastedUSD: 1 }),
        compactionEventCount: 1,
      }),
    );
    expect(a.potentialSavingsUSD).toBeCloseTo(1 + 1 + 2);
  });
});
