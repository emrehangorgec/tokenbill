import { describe, expect, it } from "vitest";
import { lookupPrice } from "../src/cost/pricing.js";

describe("price lookup (longest prefix)", () => {
  it("matches dated model ids", () => {
    const r = lookupPrice("claude-haiku-4-5-20251001");
    expect(r.exact).toBe(true);
    expect(r.price.inputPerMTok).toBe(1);
  });

  it("sonnet-5 wins over sonnet-4 prefix ordering", () => {
    expect(lookupPrice("claude-sonnet-5").price.match).toBe("claude-sonnet-5");
    expect(lookupPrice("claude-sonnet-4-6").price.match).toBe("claude-sonnet-4");
  });

  it("opus family", () => {
    expect(lookupPrice("claude-opus-4-8").price.outputPerMTok).toBe(25);
  });

  it("fable", () => {
    expect(lookupPrice("claude-fable-5").price.inputPerMTok).toBe(10);
  });

  it("unknown model falls back to sonnet rates, flagged", () => {
    const r = lookupPrice("gpt-9-mega");
    expect(r.exact).toBe(false);
    expect(r.price.inputPerMTok).toBe(3);
  });
});
