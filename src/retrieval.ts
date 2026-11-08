import type { QDivZeroClient } from "@qdivzero/qdivzero-js";
import type { IndexDocument } from "./documents.js";

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS = [1000, 2000];
const MAX_BATCH_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_CHUNKS = 10000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RetrievalApi {
  listDatabases(): Promise<unknown>;
  indexDirect(databaseId: string, documents: IndexDocument[], chunking?: ChunkingConfig): Promise<unknown>;
}

export interface ChunkingConfig { size: number; overlap: number }

export interface DatabaseRef {
  id?: string;
  slug?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorSuffix(error: unknown): string {
  if (error === undefined) return "";
  try {
    const text = JSON.stringify(error);
    return text === undefined ? "" : `: ${text.slice(0, 2000)}`;
  } catch {
    return `: ${String(error).slice(0, 2000)}`;
  }
}

export function createRetrievalApi(client: QDivZeroClient): RetrievalApi {
  return {
    async listDatabases(): Promise<unknown> {
      const { data, error, response } = await client.GET("/flexible-vector-databases", {});
      if (response.status !== 200) {
        throw new ApiError(
          `Unable to list Retrieval databases: HTTP ${response.status}${errorSuffix(error)}`,
          response.status,
        );
      }
      return data;
    },

    async indexDirect(databaseId: string, documents: IndexDocument[], chunking?: ChunkingConfig): Promise<unknown> {
      const body = { documents, ...(chunking === undefined ? {} : { chunking }) };
      const { data, error, response } = await client.POST(
        "/flexible-vector-databases/{databaseID}/index-direct",
        {
          params: { path: { databaseID: databaseId } },
          body,
        },
      );
      if (response.status !== 200) {
        throw new ApiError(
          `index-direct failed: HTTP ${response.status}${errorSuffix(error)}`,
          response.status,
        );
      }
      return data;
    },
  };
}

function toDatabaseRef(value: Record<string, unknown>): DatabaseRef {
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    slug: typeof value.slug === "string" ? value.slug : undefined,
  };
}

export function normalizeDatabaseList(data: unknown): DatabaseRef[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord).map(toDatabaseRef);
  }
  if (!isRecord(data)) return [];
  for (const key of ["databases", "items", "data"]) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord).map(toDatabaseRef);
    }
  }
  if (typeof data.id === "string" || typeof data.slug === "string") {
    return [toDatabaseRef(data)];
  }
  return [];
}

export async function resolveDatabaseID(
  api: RetrievalApi,
  databaseId: string | undefined,
  databaseSlug: string | undefined,
): Promise<string> {
  if (databaseId !== undefined && databaseId !== "") return databaseId;
  if (databaseSlug === undefined || databaseSlug === "") {
    throw new Error("A database-id or database-slug is required.");
  }

  const databases = normalizeDatabaseList(await api.listDatabases());
  const matches = databases.filter((database) => database.slug === databaseSlug);

  if (matches.length === 0) {
    const available = [
      ...new Set(
        databases
          .map((database) => database.slug)
          .filter((slug): slug is string => typeof slug === "string" && slug.length > 0),
      ),
    ].sort();
    throw new Error(
      `No Retrieval database found with slug "${databaseSlug}". Available slugs: ${
        available.length > 0 ? available.join(", ") : "(none)"
      }.`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple Retrieval databases share the slug "${databaseSlug}". Use database-id instead.`,
    );
  }

  const id = matches[0]?.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(`Retrieval database with slug "${databaseSlug}" has no ID.`);
  }
  return id;
}

export function* batchDocuments<T>(items: T[], batchSize: number): Generator<T[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("batchSize must be a positive integer.");
  }
  for (let index = 0; index < items.length; index += batchSize) {
    yield items.slice(index, index + batchSize);
  }
}

export function* batchIndexDocuments(documents: IndexDocument[], batchSize: number, chunking?: ChunkingConfig, maxBytes = MAX_BATCH_BYTES): Generator<IndexDocument[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("batchSize must be a positive integer.");
  const baseBytes = Buffer.byteLength(JSON.stringify({ documents: [], ...(chunking === undefined ? {} : { chunking }) }), "utf8");
  let batch: IndexDocument[] = [];
  let bytes = baseBytes;
  let chunks = 0;
  for (const document of documents) {
    const documentBytes = Buffer.byteLength(JSON.stringify(document), "utf8");
    if (baseBytes + documentBytes > maxBytes) throw new Error(`Document ${document.id} is too large for a single indexing request.`);
    let chars = 0;
    for (const _character of document.content) chars += 1;
    const { size, overlap } = chunking ?? { size: 2000, overlap: 200 };
    const chunkCount = chars <= size ? 1 : 1 + Math.ceil((chars - size) / (size - overlap));
    if (chunkCount > MAX_BATCH_CHUNKS) throw new Error(`Document ${document.id} would create too many chunks.`);
    const added = documentBytes + (batch.length === 0 ? 0 : 1);
    if (batch.length >= batchSize || bytes + added > maxBytes || chunks + chunkCount > MAX_BATCH_CHUNKS) {
      yield batch;
      batch = [];
      bytes = baseBytes;
      chunks = 0;
    }
    bytes += documentBytes + (batch.length === 0 ? 0 : 1);
    chunks += chunkCount;
    batch.push(document);
  }
  if (batch.length > 0) yield batch;
}

function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status !== undefined && TRANSIENT_STATUS.has(error.status);
  }
  return true;
}

async function indexBatchWithRetry(
  api: RetrievalApi,
  databaseId: string,
  documents: IndexDocument[],
  sleep: (ms: number) => Promise<void>,
  chunking?: ChunkingConfig,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.indexDirect(databaseId, documents, chunking);
    } catch (error) {
      if (!isTransient(error) || attempt >= RETRY_DELAYS.length) {
        throw error;
      }
      await sleep(RETRY_DELAYS[attempt] + Math.floor(Math.random() * 250));
    }
  }
}

export interface IndexAllOptions {
  sleep?: (ms: number) => Promise<void>;
  onBatch?: (info: { batch: number; totalBatches: number; size: number }) => void;
  chunking?: ChunkingConfig;
  requireIndexedCount?: boolean;
}

export async function indexAll(
  api: RetrievalApi,
  databaseId: string,
  documents: IndexDocument[],
  batchSize: number,
  options: IndexAllOptions = {},
): Promise<{ indexed: number; batches: number; chunksIndexed?: number }> {
  const batches = [...batchIndexDocuments(documents, batchSize, options.chunking)];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let indexed = 0;
  let chunksIndexed = 0;
  let hasChunkCounts = true;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    options.onBatch?.({ batch: index + 1, totalBatches: batches.length, size: batch.length });
    const response = await indexBatchWithRetry(api, databaseId, batch, sleep, options.chunking);
    if ((options.requireIndexedCount && (!isRecord(response) || response.indexed_count === undefined)) ||
        (isRecord(response) && response.indexed_count !== undefined && response.indexed_count !== batch.length)) {
      throw new Error(`index-direct returned an unexpected indexed_count for batch ${index + 1}.`);
    }
    indexed += batch.length;
    if (isRecord(response) && Number.isSafeInteger(response.chunks_indexed_count) && (response.chunks_indexed_count as number) >= 0) {
      chunksIndexed += response.chunks_indexed_count as number;
    } else {
      hasChunkCounts = false;
    }
  }

  return { indexed, batches: batches.length, ...(hasChunkCounts && batches.length > 0 ? { chunksIndexed } : {}) };
}
