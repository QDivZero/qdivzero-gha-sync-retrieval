import * as core from "@actions/core";

export interface SyncSummary {
  databaseId: string;
  files: number;
  documents: number;
  indexed: number;
  skipped: number;
  chunksIndexed?: number;
  removed?: number;
}

export function summaryMarkdown(summary: SyncSummary): string {
  const lines = [
    "## QDivZero Retrieval sync",
    "",
    `- Database: \`${summary.databaseId}\``,
    `- Files scanned: ${summary.files}`,
    `- Documents sent: ${summary.documents}`,
    `- Documents indexed: ${summary.indexed}`,
  ];
  if (summary.chunksIndexed !== undefined) lines.push(`- Chunks indexed: ${summary.chunksIndexed}`);
  if (summary.removed !== undefined) lines.push(`- Documents removed: ${summary.removed}`);
  if (summary.skipped > 0) {
    lines.push(`- Empty files skipped: ${summary.skipped}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function publishSummary(summary: SyncSummary): Promise<void> {
  core.setOutput("database-id", summary.databaseId);
  core.setOutput("files", String(summary.files));
  core.setOutput("documents", String(summary.documents));
  core.setOutput("indexed", String(summary.indexed));
  core.setOutput("chunks-indexed", summary.chunksIndexed === undefined ? "" : String(summary.chunksIndexed));
  core.setOutput("removed", String(summary.removed ?? 0));
  await core.summary.addRaw(summaryMarkdown(summary)).write();
}
