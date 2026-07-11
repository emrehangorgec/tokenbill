import { describe, expect, it } from "vitest";
import { encodeProjectPath } from "../src/project-dir.js";

describe("encodeProjectPath", () => {
  it("matches Claude Code's own encoding (verified against a real project dir)", () => {
    expect(encodeProjectPath("C:\\Users\\Asus\\Desktop\\tokenbill")).toBe(
      "C--Users-Asus-Desktop-tokenbill",
    );
  });

  it("handles forward slashes (posix paths)", () => {
    expect(encodeProjectPath("/home/user/projects/foo")).toBe("-home-user-projects-foo");
  });
});
