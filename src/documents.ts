import { createHash } from "node:crypto";
import type { ChunkedMarkdown } from "./markdown.js";
import type { GitHubContext } from "./inputs.js";

export interface IndexDocument {
  id: string;
  content: string;
  metadata: Record<string, string>;
}

function encodePath(relativePath: string): string {
  return relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function documentId(relativePath: string, chunkIndex: number): string {
  const hash = createHash("md5").update(relativePath).digest("hex");
  return `${hash}:${chunkIndex}`;
}

export function buildDocuments(
  relativePath: string,
  chunked: ChunkedMarkdown,
  context: GitHubContext,
): IndexDocument[] {
  return chunked.chunks.map((chunk) => ({
    id: documentId(relativePath, chunk.index),
    content: chunk.content,
    metadata: {
      repo: context.repository,
      path: relativePath,
      ref: context.refName,
      commit: context.sha,
      title: chunked.title,
      heading: chunk.headingPath.length > 0 ? chunk.headingPath.join(" > ") : chunked.title,
      chunk_index: String(chunk.index),
      url: `${context.serverUrl}/${context.repository}/blob/${context.sha}/${encodePath(relativePath)}#L${chunk.startLine}`,
    },
  }));
}
