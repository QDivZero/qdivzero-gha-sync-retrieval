import { createHash } from "node:crypto";
import type { GitHubContext } from "./inputs.js";

export interface IndexDocument {
  id: string;
  content: string;
  metadata: Record<string, string>;
}

function encodePath(relativePath: string): string {
  return relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function fileTitle(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? relativePath;
  return base.replace(/\.md$/i, "") || base;
}

export function documentId(relativePath: string): string {
  return createHash("md5").update(relativePath).digest("hex");
}

export function buildDocument(
  relativePath: string,
  content: string,
  context: GitHubContext,
): IndexDocument {
  return {
    id: documentId(relativePath),
    content,
    metadata: {
      repo: context.repository,
      path: relativePath,
      ref: context.refName,
      commit: context.sha,
      title: fileTitle(relativePath),
      url: `${context.serverUrl}/${context.repository}/blob/${context.sha}/${encodePath(relativePath)}`,
    },
  };
}
