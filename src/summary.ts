import * as core from "@actions/core";

export interface SyncSummary {
  databaseId: string;
  files: number;
  chunks: number;
  indexed: number;
  skipped: number;
  oversizedSections: number;
}

export function summaryMarkdown(summary: SyncSummary): string {
  const lines = [
    "## QDivZero Retrieval sync",
    "",
    `- Database: \`${summary.databaseId}\``,
    `- Files scanned: ${summary.files}`,
    `- Chunks generated: ${summary.chunks}`,
    `- Documents indexed: ${summary.indexed}`,
    `- Empty chunks skipped: ${summary.skipped}`,
  ];
  if (summary.oversizedSections > 0) {
    lines.push(`- Oversized sections: ${summary.oversizedSections}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function publishSummary(summary: SyncSummary): Promise<void> {
  core.setOutput("database-id", summary.databaseId);
  core.setOutput("files", String(summary.files));
  core.setOutput("chunks", String(summary.chunks));
  core.setOutput("indexed", String(summary.indexed));
  core.setOutput("skipped", String(summary.skipped));
  await core.summary.addRaw(summaryMarkdown(summary)).write();
}
