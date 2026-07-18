import { describe, expect, it } from "vitest";
import { enhanceMarkdownImageLinks } from "../../../src/side-panel/components/MessageList";

describe("enhanceMarkdownImageLinks", () => {
  it("converts bare image urls into markdown images", () => {
    const url = "https://pub-62e693a7058040f98bba94ed1d6f880b.r2.dev/images/1f69457f-d8b9-4e23-b109-f96a419111bd.png";
    const input = `图片链接：\n${url}`;
    const output = enhanceMarkdownImageLinks(input);
    expect(output).toContain(`![生成图片](${url})`);
  });

  it("does not double-wrap existing markdown images", () => {
    const url = "https://example.com/a.png";
    const input = `![已有](${url})`;
    expect(enhanceMarkdownImageLinks(input)).toBe(input);
  });
});
