import { describe, expect, it, vi } from "vitest";
import { cleanupDocuments, type CleanupApi } from "../src/cleanup.js";
import { documentId } from "../src/documents.js";

const repo = "example/project";
const ref = "main";
const marker = "qdivzero-gha-sync-retrieval";
const item = (path: string, extras: Record<string, unknown> = {}) => ({
  id: documentId(path), parent_document_id: documentId(path),
  metadata: { repo, ref, path, action: marker }, ...extras,
});

describe("cleanupDocuments", () => {
  it("only deletes stale owned documents in scope, deduplicating chunks across pages", async () => {
    const first = item("docs/removed.md");
    const api: CleanupApi = {
      listDocuments: vi.fn().mockResolvedValueOnce({ documents: [first, item("docs/live.md"), item("private/secret.md"), item("docs/foreign.md", { metadata: { repo: "other/project", ref, path: "docs/foreign.md", action: marker } })], next_cursor: "next" })
        .mockResolvedValueOnce({ documents: [{ ...first, id: "chunk-hash" }] }),
      purgeDocument: vi.fn().mockResolvedValue(undefined),
    };
    const result = await cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: ["docs/live.md"], indexedPaths: ["docs/live.md"], include: ["docs/**"], exclude: [], prune: true, removeLegacy: false });
    expect(result).toEqual({ removed: 1 });
    expect(api.purgeDocument).toHaveBeenCalledOnce();
    expect(api.purgeDocument).toHaveBeenCalledWith("db", documentId("docs/removed.md"));
  });

  it("removes only validated legacy chunks for files just indexed", async () => {
    const legacy = `${documentId("docs/live.md")}:2`;
    const api: CleanupApi = {
      listDocuments: vi.fn().mockResolvedValue({ documents: [
        { id: legacy, parent_document_id: legacy, metadata: { repo, ref, path: "docs/live.md" } },
        { id: "unrelated:2", parent_document_id: "unrelated:2", metadata: { repo, ref, path: "docs/live.md" } },
        { id: `${documentId("docs/blank.md")}:0`, parent_document_id: `${documentId("docs/blank.md")}:0`, metadata: { repo, ref, path: "docs/blank.md" } },
      ] }),
      purgeDocument: vi.fn().mockResolvedValue(undefined),
    };
    await cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: ["docs/live.md", "docs/blank.md"], indexedPaths: ["docs/live.md"], include: [], exclude: [], prune: false, removeLegacy: true });
    expect(api.purgeDocument).toHaveBeenCalledExactlyOnceWith("db", legacy);
  });

  it("does not delete anything if pagination fails or repeats", async () => {
    const api: CleanupApi = { listDocuments: vi.fn().mockResolvedValue({ documents: [item("old.md")], next_cursor: "same" }), purgeDocument: vi.fn() };
    await expect(cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: ["live.md"], indexedPaths: ["live.md"], include: [], exclude: [], prune: true, removeLegacy: false })).rejects.toThrow(/cursor/i);
    expect(api.purgeDocument).not.toHaveBeenCalled();
  });

  it("fails closed for old list responses that do not include parent IDs", async () => {
    const api: CleanupApi = { listDocuments: vi.fn().mockResolvedValue({ documents: [{ id: "old", metadata: { repo, ref, path: "old.md", action: marker } }] }), purgeDocument: vi.fn() };
    await expect(cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: ["live.md"], indexedPaths: ["live.md"], include: [], exclude: [], prune: true, removeLegacy: false })).rejects.toThrow(/parent IDs/i);
    expect(api.purgeDocument).not.toHaveBeenCalled();
  });

  it("never prunes unmarked or differently scoped records", async () => {
    const api: CleanupApi = { listDocuments: vi.fn().mockResolvedValue({ documents: [
      item("old.md", { metadata: { repo, ref, path: "old.md" } }),
      item("other-ref.md", { metadata: { repo, ref: "other", path: "other-ref.md", action: marker } }),
      item("outside.md"),
      item("docs/excluded.md"),
    ] }), purgeDocument: vi.fn() };
    await cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: ["docs/live.md"], indexedPaths: ["docs/live.md"], include: ["docs/**"], exclude: ["docs/excluded.md"], prune: true, removeLegacy: false });
    expect(api.purgeDocument).not.toHaveBeenCalled();
  });

  it("refuses pruning when no matching files were found", async () => {
    const api: CleanupApi = { listDocuments: vi.fn(), purgeDocument: vi.fn() };
    await expect(cleanupDocuments(api, "db", { repository: repo, ref, trackedPaths: [], indexedPaths: [], include: [], exclude: [], prune: true, removeLegacy: false })).rejects.toThrow(/no matching/i);
    expect(api.listDocuments).not.toHaveBeenCalled();
  });
});
