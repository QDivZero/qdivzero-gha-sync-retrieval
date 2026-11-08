import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as core from "@actions/core";
import { createQDivZeroClient } from "@qdivzero/qdivzero-js";
import { readGitHubContext, readInputs, versionedBaseUrl } from "./inputs.js";
import { listTrackedMarkdown } from "./git.js";
import { buildDocument, type IndexDocument } from "./documents.js";
import { ApiError, createRetrievalApi, indexAll, resolveDatabaseID } from "./retrieval.js";
import { publishSummary } from "./summary.js";
import { cleanupDocuments, createCleanupApi } from "./cleanup.js";

export async function run(): Promise<void> {
  const inputs = readInputs();
  core.setSecret(inputs.apiKey);
  const context = readGitHubContext();
	const baseUrl = versionedBaseUrl(inputs.baseUrl);

  const api = createRetrievalApi(
    createQDivZeroClient({
      apiKey: inputs.apiKey,
      baseUrl,
      loadCredentialsFile: false,
    }),
  );

  const databaseId = await resolveDatabaseID(api, inputs.databaseId, inputs.databaseSlug);
  const files = await listTrackedMarkdown(context.workspace, inputs.paths, inputs.exclude);
  const cleanup = (indexedPaths: string[]) => cleanupDocuments(createCleanupApi(baseUrl, inputs.apiKey), databaseId, {
    repository: context.repository,
    ref: context.refName,
    trackedPaths: files,
    indexedPaths,
    include: inputs.paths,
    exclude: inputs.exclude,
    prune: inputs.prune,
    removeLegacy: inputs.removeLegacy,
  });

  if (files.length === 0) {
    if (inputs.prune) throw new Error("Refusing to prune because no matching tracked Markdown files were found.");
    core.warning("No tracked Markdown files matched the configured paths or exclude patterns.");
    await publishSummary({
      databaseId,
      files: 0,
      documents: 0,
      indexed: 0,
      skipped: 0,
    });
    return;
  }

  let skipped = 0;
  const documents: IndexDocument[] = [];

  for (const file of files) {
    const source = await readFile(join(context.workspace, file), "utf8");
    if (source.trim() === "") {
      skipped += 1;
      continue;
    }
    documents.push(buildDocument(file, source, context));
  }

  if (skipped > 0) {
    core.warning(`${skipped} empty Markdown file(s) skipped.`);
  }

  if (documents.length === 0) {
    core.warning("No indexable Markdown content found.");
    const { removed } = inputs.prune ? await cleanup([]) : { removed: 0 };
    await publishSummary({
      databaseId,
      files: files.length,
      documents: 0,
      indexed: 0,
      skipped,
      removed,
    });
    return;
  }

  const { indexed, chunksIndexed } = await indexAll(api, databaseId, documents, inputs.batchSize, {
    chunking: inputs.chunking,
    requireIndexedCount: inputs.prune || inputs.removeLegacy,
    onBatch: ({ batch, totalBatches, size }) => {
      core.info(`Indexing batch ${batch}/${totalBatches} (${size} documents).`);
    },
  });

  const { removed } = await cleanup(documents.map((doc) => doc.metadata.path));

  await publishSummary({
    databaseId,
    files: files.length,
    documents: documents.length,
    indexed,
    skipped,
    chunksIndexed,
    removed,
  });
}

run().catch((error: unknown) => {
  if (error instanceof ApiError) {
    core.setFailed(error.message);
    return;
  }
  core.setFailed(error instanceof Error ? error.message : String(error));
});
