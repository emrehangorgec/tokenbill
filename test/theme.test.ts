import { afterEach, describe, expect, it } from "vitest";
import { bold, dim, paint, setColorEnabled, visibleWidth } from "../src/report/theme.js";

describe("theme", () => {
  afterEach(() => setColorEnabled(false));

  it("visibleWidth strips ANSI escapes", () => {
    setColorEnabled(true);
    const s = bold(paint(45, "hello")) + dim(" world");
    expect(s).not.toBe("hello world");
    expect(visibleWidth(s)).toBe("hello world".length);
  });

  it("emits plain text when color is disabled", () => {
    setColorEnabled(false);
    expect(bold("x")).toBe("x");
    expect(dim("x")).toBe("x");
    expect(paint(45, "x")).toBe("x");
  });

  it("colored and plain output have identical visible alignment", () => {
    const label = "Cache writes".padEnd(30);
    setColorEnabled(true);
    const colored = paint(179, label) + "$1.00".padStart(8);
    setColorEnabled(false);
    const plain = paint(179, label) + "$1.00".padStart(8);
    expect(visibleWidth(colored)).toBe(plain.length);
  });
});
