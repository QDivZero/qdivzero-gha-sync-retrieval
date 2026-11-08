import { documentId } from "./documents.js";
import { matchesMarkdownPath } from "./git.js";

export interface CleanupApi {
  listDocuments(databaseId: string, cursor?: string): Promise<unknown>;
  purgeDocument(databaseId: string, parentId: string): Promise<void>;
}

export interface CleanupOptions {
  repository: string;
  ref: string;
  trackedPaths: string[];
  indexedPaths: string[];
  include: string[];
  exclude: string[];
  prune: boolean;
  removeLegacy: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function cleanupDocuments(api: CleanupApi, databaseId: string, options: CleanupOptions): Promise<{ removed: number }> {
  if (!options.prune && !options.removeLegacy) return { removed: 0 };
  if (options.prune && options.trackedPaths.length === 0) {
    throw new Error("Refusing to prune because no matching tracked Markdown files were found.");
  }
  const tracked = new Set(options.trackedPaths);
  const indexed = new Set(options.indexedPaths);
  const toRemove = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const response = await api.listDocuments(databaseId, cursor);
    if (!isRecord(response) || !Array.isArray(response.documents) || (response.next_cursor !== undefined && typeof response.next_cursor !== "string")) {
      throw new Error("Invalid document listing; no cleanup was performed.");
    }
    for (const doc of response.documents) {
      if (!isRecord(doc) || typeof doc.id !== "string" || typeof doc.parent_document_id !== "string" || doc.parent_document_id === "") {
        throw new Error("Document listing does not expose chunk parent IDs; no cleanup was performed.");
      }
      if (!isRecord(doc.metadata)) continue;
      const { repo, ref, path, action } = doc.metadata;
      if (repo !== options.repository || ref !== options.ref || typeof path !== "string" || !matchesMarkdownPath(path, options.include, options.exclude)) continue;
      const root = documentId(path);
      if (options.prune && action === "qdivzero-gha-sync-retrieval" && doc.parent_document_id === root && !tracked.has(path)) {
        toRemove.add(root);
      }
      if (options.removeLegacy && (action === undefined || action === "qdivzero-gha-sync-retrieval") && indexed.has(path) && doc.id === doc.parent_document_id && /^\d+$/.test(doc.id.slice(root.length + 1)) && doc.id.startsWith(`${root}:`)) {
        toRemove.add(doc.id);
      }
    }
    const next = response.next_cursor;
    if (typeof next !== "string" || next === "") break;
    if (cursors.has(next)) throw new Error("Document listing returned a repeated cursor; no cleanup was performed.");
    cursors.add(next);
    cursor = next;
  } while (true);
  for (const id of toRemove) await api.purgeDocument(databaseId, id);
  return { removed: toRemove.size };
}

export function createCleanupApi(baseUrl: string, apiKey: string): CleanupApi {
  const documentsUrl = (databaseId: string): string => `${baseUrl}/flexible-vector-databases/${encodeURIComponent(databaseId)}/documents`;
  async function request(url: string, method: "GET" | "DELETE"): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" });
    } catch {
      throw new Error(`Cleanup ${method} request failed.`);
    }
    if (!response.ok) throw new Error(`Cleanup ${method} request failed: HTTP ${response.status}.`);
    return response;
  }
  return {
    async listDocuments(databaseId, cursor) {
      const url = new URL(documentsUrl(databaseId));
      url.searchParams.set("limit", "50");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await request(url.toString(), "GET");
      try { return await response.json(); } catch { throw new Error("Cleanup document listing returned invalid JSON."); }
    },
    async purgeDocument(databaseId, parentId) {
      await request(`${documentsUrl(databaseId)}/${encodeURIComponent(parentId)}/chunks`, "DELETE");
    },
  };
}
