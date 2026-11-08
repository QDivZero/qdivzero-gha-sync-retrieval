# qdivzero-gha-sync-retrieval

GitHub Action that syncs tracked Markdown files from a repository into a
QDivZero Retrieval database.

The action sends one complete document per file. The Retrieval API splits the
text into overlapping chunks, assigns chunk IDs, and replaces a document's
previous chunks when the same ID is indexed again. The current API uses fixed
character windows; it does not split on Markdown headings or code blocks.

## Releases

- `v2.0.0`: current release. Recommended for normal use. See the
  [v2.0.0 release notes](https://github.com/QDivZero/qdivzero-gha-sync-retrieval/releases/tag/v2.0.0)
  for the chunked API and cleanup changes.

For stricter supply-chain control, pin the action to the release commit SHA.

## Prerequisites

- A QDivZero account API key (`tk_<prefix>.<secret>`) with access to Retrieval.
- A Retrieval database and its slug or ID.
- The database's embedding deployment running when documents are indexed.

Store the API key as a repository secret named `QDIVZERO_API_KEY`.

## Usage

```yaml
name: Sync docs to QDivZero Retrieval

on:
  push:
    branches: [main]
    paths:
      - "**/*.md"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: qdivzero-retrieval-${{ github.repository }}
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: QDivZero/qdivzero-gha-sync-retrieval@v2.0.0
        with:
          api-key: ${{ secrets.QDIVZERO_API_KEY }}
          database-slug: my-repo-docs
```

Use `database-id` instead of `database-slug` when you already know the database
ID. Exactly one of the two inputs is required.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | Yes | - | QDivZero account API key. |
| `database-id` | One of | - | Retrieval database ID. |
| `database-slug` | One of | - | Retrieval database slug, resolved through the list endpoint. |
| `base-url` | No | `https://api.qdiv0.com` | QDivZero API base URL. |
| `paths` | No | all tracked `.md` | Newline-separated include globs. |
| `exclude` | No | - | Newline-separated exclude globs. |
| `batch-size` | No | `50` | Documents per `index-direct` request. |
| `chunk-size` | No | API default | Maximum Unicode characters per chunk, between 1 and 20,000. Supply with `chunk-overlap`. |
| `chunk-overlap` | No | API default | Characters shared by consecutive chunks, at most half of `chunk-size`. Supply with `chunk-size`. |
| `prune` | No | `false` | Remove this action's previously indexed documents for tracked files that no longer exist within the selected paths. |
| `remove-legacy` | No | `false` | Remove identifiable chunks from older action versions after their files are successfully indexed. |

## Outputs

| Output | Description |
| --- | --- |
| `database-id` | Resolved Retrieval database ID. |
| `files` | Markdown files scanned. |
| `documents` | Documents sent to the API. |
| `indexed` | Documents accepted by the API. |
| `chunks-indexed` | Chunks reported by the API, or an empty string if the API does not report this count. |
| `removed` | Number of document records removed by optional cleanup. |

## How it works

- Enumerates tracked Markdown with `git ls-files`.
- Sends one document per file with `id = md5(relative_path)` and the full
  Markdown content.
- Adds file-level metadata: action, repository, path, ref, commit, title, and
  URL.
- The Retrieval API splits text into 2,000-character chunks with 200-character
  overlap by default. Set both chunk inputs to override those values.
- Re-indexing the same document replaces its previous chunks.
- Empty files are skipped.
- Sends sequential batches to the versioned `index-direct` endpoint with
  retries on 429/5xx/network errors. Batches are also bounded by request bytes
  and the API's chunk-count limit.
- With `prune: true`, removes stale documents previously marked by this action
  for the same repository and ref, within `paths` and outside `exclude`.
- With `remove-legacy: true`, removes identifiable legacy chunks for files
  successfully indexed in the current run. Cleanup starts only after all
  indexing requests succeed.
- Publishes a step summary and the outputs above.

## Verify the index

Use the `database-id` output, or resolve the slug first, and search the
database:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${QDIVZERO_API_KEY}" \
  -H "Content-Type: application/json" \
  -X POST "https://api.qdiv0.com/v1/flexible-vector-databases/<database-id>/search" \
  -d '{"query":"your question","top_k":5}'
```

## Troubleshooting

- `401 invalid access token`: use a valid QDivZero account API key (`tk_...`)
  and confirm that it can access Retrieval.
- Slug not found: check the slug and the account that owns the database.
- No documents indexed: confirm that the Markdown files are tracked by Git and
  match `paths`/`exclude`.

## Limitations

- Cleanup is disabled by default. If enabled, it requires an API deployment
  with paginated chunk listing and grouped deletion. Pruning refuses to run
  when no tracked Markdown files match the selected paths. Empty tracked files
  are skipped and are not considered deleted.
- Legacy cleanup is opt-in and only considers previously indexed records whose
  repository, ref, path, and legacy ID match a file indexed in the current run.
  It does not remove legacy chunks for files deleted before the current run.
- If multiple repositories share one database, identical relative paths produce
  identical document IDs. Different refs of the same repository also share IDs.
  Use a separate database per repository and ref to avoid overwrites.
- Indexing a single document larger than 12 MiB is not supported by this action;
  `batch-size` does not bypass that bound. The action fails before indexing if
  an individual document or a generated batch exceeds the supported chunk limit.
- The API uses fixed windows rather than Markdown-aware boundaries, and the
  action supplies file-level URLs rather than line anchors.
- The API does not persist a document's custom chunk settings. Retain them if
  you need to reconstruct the original text from chunks.
- Use workflow concurrency to avoid simultaneous sync and cleanup for the same
  database. An indexing job already in flight can recreate a deleted document.
- The Retrieval API must support server-side chunking and per-document chunk
  replacement.

## Repository access

This is a public action. Caller repositories can use it directly; no private
action access configuration is required.

## CI and dist

`dist/index.cjs` is committed because GitHub runs the action from the bundle.

On every push, `.github/workflows/sync-dist.yml`:

- runs typecheck, build, and tests;
- commits `dist/index.cjs` if the bundle changed;
- triggers CI on the rebuilt commit.

You normally do not need to build `dist/` manually. For a local check:

```bash
npm ci
npm run typecheck
npm run build
npm test
git diff --exit-code -- dist
```

If branch protection blocks `github-actions[bot]`, allow the bot to push or run
the build manually and commit `dist/index.cjs`.
