import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDocument, documentId } from "../src/documents.js";
import type { GitHubContext } from "../src/inputs.js";

const context: GitHubContext = {
  workspace: "/repo",
  repository: "QDivZero/example",
  refName: "main",
  sha: "abc123",
  serverUrl: "https://github.com",
};

describe("documentId", () => {
  it("uses md5 of the relative path", () => {
    const hash = createHash("md5").update("docs/guide.md").digest("hex");
    expect(documentId("docs/guide.md")).toBe(hash);
  });
});

describe("buildDocument", () => {
  it("builds one document with the full content and file metadata", () => {
    const content = "# Guide\n\n## Install\n\nBody.";
    const document = buildDocument("docs/guide.md", content, context);

    expect(document.id).toBe(documentId("docs/guide.md"));
    expect(document.content).toBe(content);
    expect(document.metadata).toEqual({
      repo: "QDivZero/example",
      path: "docs/guide.md",
      ref: "main",
      commit: "abc123",
      title: "guide",
      url: "https://github.com/QDivZero/example/blob/abc123/docs/guide.md",
    });
    expect(document.metadata.heading).toBeUndefined();
    expect(document.metadata.chunk_index).toBeUndefined();
  });

  it("encodes special characters in the URL path", () => {
    const document = buildDocument("docs/my guide.md", "# Guide", context);
    expect(document.metadata.url).toContain("docs/my%20guide.md");
  });
});
