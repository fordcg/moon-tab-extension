import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

describe("Vitest discovery configuration", () => {
  it("keeps legacy Node runner tests and scratch copies out of Vitest", () => {
    const exclude = Array.isArray(config.test?.exclude) ? config.test.exclude : [];

    expect(exclude).toContain(".tmp/**");
    expect(exclude).toContain("src/pages/**/*.test.mjs");
  });
});
