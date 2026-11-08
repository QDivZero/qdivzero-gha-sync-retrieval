import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/markdown.js";

describe("chunkMarkdown", () => {
  it("groups heading sections under the limit", () => {
    const result = chunkMarkdown(
      "# Guide\n\nIntro.\n\n## Install\n\nRun it.\n\n## Use\n\nCall it.\n",
      "docs/guide.md",
      1000,
    );
    expect(result.title).toBe("Guide");
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].headingPath).toEqual(["Guide"]);
    expect(result.chunks[0].content).toContain("## Install");
    expect(result.chunks[0].content).toContain("Call it.");
  });

  it("splits when the limit is exceeded", () => {
    const result = chunkMarkdown(
      "# Guide\n\nA\n\n## Install\n\nB\n\n## Use\n\nC\n",
      "guide.md",
      20,
    );
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("ignores headings inside fenced code blocks", () => {
    const result = chunkMarkdown(
      "# Guide\n\n```md\n# Not a heading\n```\n\n## Real\n\nBody.\n",
      "guide.md",
      1000,
    );
    expect(result.chunks[0].content).toContain("# Not a heading");
    expect(result.chunks[0].headingPath).toEqual(["Guide"]);
  });

  it("handles CRLF input", () => {
    const result = chunkMarkdown("# Guide\r\n\r\nBody.\r\n", "guide.md", 1000);
    expect(result.title).toBe("Guide");
    expect(result.chunks[0].content).toContain("Body.");
  });

  it("keeps preamble content", () => {
    const result = chunkMarkdown("Intro before heading.\n\n# Guide\n\nBody.\n", "guide.md", 1000);
    expect(result.chunks[0].headingPath).toEqual([]);
    expect(result.chunks[0].content).toContain("Intro before heading.");
  });

  it("uses the file name when there is no heading", () => {
    const result = chunkMarkdown("Just text.\n", "docs/notes.md", 1000);
    expect(result.title).toBe("notes");
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].headingPath).toEqual([]);
  });

  it("emits oversized sections without splitting them", () => {
    const result = chunkMarkdown("# Guide\n\n" + "x".repeat(300) + "\n", "guide.md", 200);
    expect(result.chunks).toHaveLength(1);
    expect(result.oversizedSections).toBe(1);
  });

  it("counts skipped empty chunks", () => {
    const result = chunkMarkdown("\n\n# Guide\n\nBody.\n", "guide.md", 1000);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("does not treat setext headings as headings", () => {
    const result = chunkMarkdown("Title\n=====\n\nBody.\n", "notes.md", 1000);
    expect(result.title).toBe("notes");
    expect(result.chunks[0].headingPath).toEqual([]);
  });

  it("handles heading level jumps", () => {
    const result = chunkMarkdown("# A\n\n### C\n\nBody.\n", "a.md", 12);
    expect(result.chunks.map((chunk) => chunk.headingPath)).toContainEqual(["A", "C"]);
  });
});
