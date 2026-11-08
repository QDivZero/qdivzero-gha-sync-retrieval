import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDocuments, documentId } from "../src/documents.js";
import type { GitHubContext } from "../src/inputs.js";

const context: GitHubContext = {
  workspace: "/repo",
  repository: "QDivZero/example",
  refName: "main",
  sha: "abc123",
  serverUrl: "https://github.com",
};

describe("documentId", () => {
  it("uses md5 of the relative path and the chunk index", () => {
    const hash = createHash("md5").update("docs/guide.md").digest("hex");
    expect(documentId("docs/guide.md", 2)).toBe(`${hash}:2`);
  });
});

describe("buildDocuments", () => {
  it("builds ids, content, metadata, and URLs", () => {
    const documents = buildDocuments(
      "docs/guide.md",
      {
        title: "Guide",
        chunks: [
          {
            index: 0,
            headingPath: ["Guide", "Install"],
            startLine: 5,
            content: "# Guide\n\n## Install\n\nBody.",
          },
        ],
        skipped: 0,
        oversizedSections: 0,
      },
      context,
    );

    expect(documents).toHaveLength(1);
    expect(documents[0].content).toContain("Body.");
    expect(documents[0].metadata).toEqual({
      repo: "QDivZero/example",
      path: "docs/guide.md",
      ref: "main",
      commit: "abc123",
      title: "Guide",
      heading: "Guide > Install",
      chunk_index: "0",
      url: "https://github.com/QDivZero/example/blob/abc123/docs/guide.md#L5",
    });
  });

  it("uses the title for preamble chunks", () => {
    const documents = buildDocuments(
      "README.md",
      {
        title: "Readme",
        chunks: [{ index: 0, headingPath: [], startLine: 1, content: "Intro." }],
        skipped: 0,
        oversizedSections: 0,
      },
      context,
    );
    expect(documents[0].metadata.heading).toBe("Readme");
  });

  it("encodes special characters in the URL path", () => {
    const documents = buildDocuments(
      "docs/my guide.md",
      {
        title: "Guide",
        chunks: [{ index: 0, headingPath: ["Guide"], startLine: 1, content: "# Guide" }],
        skipped: 0,
        oversizedSections: 0,
      },
      context,
    );
    expect(documents[0].metadata.url).toContain("docs/my%20guide.md#L1");
  });
});
