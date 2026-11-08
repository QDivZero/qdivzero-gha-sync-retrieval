import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  batchDocuments,
  batchIndexDocuments,
  indexAll,
  normalizeDatabaseList,
  resolveDatabaseID,
  type RetrievalApi,
} from "../src/retrieval.js";
import type { IndexDocument } from "../src/documents.js";

function doc(index: number): IndexDocument {
  return {
    id: `id-${index}`,
    content: `content-${index}`,
    metadata: { chunk_index: String(index) },
  };
}

function makeApi(overrides: Partial<RetrievalApi> = {}): RetrievalApi {
  return {
    listDatabases: vi.fn().mockResolvedValue([]),
    indexDirect: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("normalizeDatabaseList", () => {
  it("accepts arrays, wrappers, and single objects", () => {
    const item = { id: "db_1", slug: "docs" };
    expect(normalizeDatabaseList([item])).toEqual([item]);
    expect(normalizeDatabaseList({ databases: [item] })).toEqual([item]);
    expect(normalizeDatabaseList({ items: [item] })).toEqual([item]);
    expect(normalizeDatabaseList({ data: [item] })).toEqual([item]);
    expect(normalizeDatabaseList(item)).toEqual([item]);
  });

  it("returns an empty list for unknown shapes", () => {
    expect(normalizeDatabaseList(null)).toEqual([]);
    expect(normalizeDatabaseList({ unexpected: true })).toEqual([]);
  });
});

describe("batchDocuments", () => {
  it("splits documents into batches", () => {
    expect([...batchDocuments([1, 2, 3, 4, 5], 2)]).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("batchIndexDocuments", () => {
  it("splits by UTF-8 request size as well as document count", () => {
    const docs = [{ ...doc(1), content: "é".repeat(100) }, { ...doc(2), content: "é".repeat(100) }];
    const oneSize = Buffer.byteLength(JSON.stringify({ documents: [docs[0]] }));
    expect([...batchIndexDocuments(docs, 50, undefined, oneSize + 1)]).toEqual([[docs[0]], [docs[1]]]);
  });

  it("rejects a single oversized document before making requests", async () => {
    const api = makeApi();
    await expect(indexAll(api, "db", [{ ...doc(1), content: "x".repeat(13 * 1024 * 1024) }], 50)).rejects.toThrow(/too large/i);
    expect(api.indexDirect).not.toHaveBeenCalled();
  });

  it("respects the API limit on the number of chunks in a request", () => {
    const docs = [{ ...doc(1), content: "x".repeat(6000) }, { ...doc(2), content: "x".repeat(6000) }];
    expect([...batchIndexDocuments(docs, 50, { size: 1, overlap: 0 })]).toEqual([[docs[0]], [docs[1]]]);
    expect(() => [...batchIndexDocuments([{ ...doc(1), content: "x".repeat(10001) }], 50, { size: 1, overlap: 0 })]).toThrow(/too many chunks/i);
  });
});

describe("resolveDatabaseID", () => {
  it("returns an explicit database id", async () => {
    const api = makeApi();
    await expect(resolveDatabaseID(api, "db_direct", undefined)).resolves.toBe("db_direct");
    expect(api.listDatabases).not.toHaveBeenCalled();
  });

  it("resolves a slug through the list endpoint", async () => {
    const api = makeApi({
      listDatabases: vi.fn().mockResolvedValue({ databases: [{ id: "db_1", slug: "docs" }] }),
    });
    await expect(resolveDatabaseID(api, undefined, "docs")).resolves.toBe("db_1");
  });

  it("fails when the slug is missing", async () => {
    const api = makeApi({
      listDatabases: vi.fn().mockResolvedValue({ databases: [{ id: "db_1", slug: "other" }] }),
    });
    await expect(resolveDatabaseID(api, undefined, "docs")).rejects.toThrow(/Available slugs: other/);
  });

  it("fails when the slug is ambiguous", async () => {
    const api = makeApi({
      listDatabases: vi.fn().mockResolvedValue([
        { id: "db_1", slug: "docs" },
        { id: "db_2", slug: "docs" },
      ]),
    });
    await expect(resolveDatabaseID(api, undefined, "docs")).rejects.toThrow(/Multiple/);
  });
});

describe("indexAll", () => {
  it("passes server chunking to each index request and reports the API chunk count", async () => {
    const api = makeApi({ indexDirect: vi.fn().mockResolvedValue({ indexed_count: 1, chunks_indexed_count: 3 }) });
    const result = await indexAll(api, "db_1", [doc(1)], 10, { chunking: { size: 2000, overlap: 200 } });
    expect(api.indexDirect).toHaveBeenCalledWith("db_1", [doc(1)], { size: 2000, overlap: 200 });
    expect(result).toEqual({ indexed: 1, batches: 1, chunksIndexed: 3 });
  });

  it("fails if the API reports that a batch was not fully indexed", async () => {
    const api = makeApi({ indexDirect: vi.fn().mockResolvedValue({ indexed_count: 0 }) });
    await expect(indexAll(api, "db", [doc(1)], 1)).rejects.toThrow(/indexed_count/i);
  });

  it("requires an indexed count when cleanup depends on confirmed indexing", async () => {
    const api = makeApi({ indexDirect: vi.fn().mockResolvedValue({}) });
    await expect(indexAll(api, "db", [doc(1)], 1, { requireIndexedCount: true })).rejects.toThrow(/indexed_count/i);
  });
  it("sends sequential batches and counts documents", async () => {
    const api = makeApi();
    const result = await indexAll(api, "db_1", [doc(1), doc(2), doc(3)], 2, {
      sleep: async () => undefined,
    });
    expect(result).toEqual({ indexed: 3, batches: 2 });
    expect(api.indexDirect).toHaveBeenCalledTimes(2);
  });

  it("retries transient failures", async () => {
    const api = makeApi({
      indexDirect: vi
        .fn()
        .mockRejectedValueOnce(new ApiError("rate limited", 429))
        .mockResolvedValueOnce({}),
    });
    const sleeps: number[] = [];
    await indexAll(api, "db_1", [doc(1)], 10, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(api.indexDirect).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
  });

  it("does not retry non-transient failures", async () => {
    const api = makeApi({
      indexDirect: vi.fn().mockRejectedValue(new ApiError("bad request", 400)),
    });
    await expect(
      indexAll(api, "db_1", [doc(1)], 10, { sleep: async () => undefined }),
    ).rejects.toThrow(/bad request/);
    expect(api.indexDirect).toHaveBeenCalledTimes(1);
  });

  it("stops after the retry limit", async () => {
    const api = makeApi({
      indexDirect: vi.fn().mockRejectedValue(new ApiError("server error", 500)),
    });
    await expect(
      indexAll(api, "db_1", [doc(1)], 10, { sleep: async () => undefined }),
    ).rejects.toThrow(/server error/);
    expect(api.indexDirect).toHaveBeenCalledTimes(3);
  });
});
