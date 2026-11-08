import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as core from "@actions/core";
import { createQDivZeroClient } from "@qdivzero/qdivzero-js";
import { readGitHubContext, readInputs } from "./inputs.js";
import { listTrackedMarkdown } from "./git.js";
import { chunkMarkdown } from "./markdown.js";
import { buildDocuments, type IndexDocument } from "./documents.js";
import { ApiError, createRetrievalApi, indexAll, resolveDatabaseID } from "./retrieval.js";
import { publishSummary } from "./summary.js";

export async function run(): Promise<void> {
  const inputs = readInputs();
  core.setSecret(inputs.apiKey);
  const context = readGitHubContext();

  const api = createRetrievalApi(
    createQDivZeroClient({
      apiKey: inputs.apiKey,
      baseUrl: inputs.baseUrl,
      loadCredentialsFile: false,
    }),
  );

  const databaseId = await resolveDatabaseID(api, inputs.databaseId, inputs.databaseSlug);
  const files = await listTrackedMarkdown(context.workspace, inputs.paths, inputs.exclude);

  if (files.length === 0) {
    core.warning("No tracked Markdown files matched the configured paths or exclude patterns.");
    await publishSummary({
      databaseId,
      files: 0,
      chunks: 0,
      indexed: 0,
      skipped: 0,
      oversizedSections: 0,
    });
    return;
  }

  let chunks = 0;
  let skipped = 0;
  let oversizedSections = 0;
  const documents: IndexDocument[] = [];

  for (const file of files) {
    const source = await readFile(join(context.workspace, file), "utf8");
    const chunked = chunkMarkdown(source, file, inputs.maxChunkChars);
    chunks += chunked.chunks.length;
    skipped += chunked.skipped;
    oversizedSections += chunked.oversizedSections;
    documents.push(...buildDocuments(file, chunked, context));
  }

  if (oversizedSections > 0) {
    core.warning(
      `${oversizedSections} Markdown section(s) exceeded max-chunk-chars and were indexed without splitting.`,
    );
  }

  if (documents.length === 0) {
    core.warning("No indexable Markdown content found.");
    await publishSummary({
      databaseId,
      files: files.length,
      chunks,
      indexed: 0,
      skipped,
      oversizedSections,
    });
    return;
  }

  const { indexed } = await indexAll(api, databaseId, documents, inputs.batchSize, {
    onBatch: ({ batch, totalBatches, size }) => {
      core.info(`Indexing batch ${batch}/${totalBatches} (${size} documents).`);
    },
  });

  await publishSummary({
    databaseId,
    files: files.length,
    chunks,
    indexed,
    skipped,
    oversizedSections,
  });
}

run().catch((error: unknown) => {
  if (error instanceof ApiError) {
    core.setFailed(error.message);
    return;
  }
  core.setFailed(error instanceof Error ? error.message : String(error));
});
