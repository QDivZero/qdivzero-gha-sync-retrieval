import { describe, expect, it } from "vitest";
import { summaryMarkdown } from "../src/summary.js";

describe("summaryMarkdown", () => {
  it("renders counts and the database id", () => {
    const markdown = summaryMarkdown({
      databaseId: "db_1",
      files: 3,
      chunks: 5,
      indexed: 5,
      skipped: 1,
      oversizedSections: 0,
    });
    expect(markdown).toContain("## QDivZero Retrieval sync");
    expect(markdown).toContain("`db_1`");
    expect(markdown).toContain("Files scanned: 3");
    expect(markdown).toContain("Documents indexed: 5");
  });

  it("includes oversized sections when present", () => {
    const markdown = summaryMarkdown({
      databaseId: "db_1",
      files: 1,
      chunks: 1,
      indexed: 1,
      skipped: 0,
      oversizedSections: 2,
    });
    expect(markdown).toContain("Oversized sections: 2");
  });
});
