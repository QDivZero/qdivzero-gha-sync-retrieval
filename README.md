# qdivzero-gha-sync-retrieval

GitHub Action that syncs tracked Markdown files from a repository into a
QDivZero Retrieval database.

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
      - uses: actions/checkout@v4
      - uses: QDivZero/qdivzero-gha-sync-retrieval@v1
        with:
          api-key: ${{ secrets.QDIV0_API_KEY }}
          database-slug: my-repo-docs
```

Use `database-id` instead of `database-slug` when you already know the database
ID. Exactly one of the two inputs is required.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | Yes | - | QDivZero API key. |
| `database-id` | One of | - | Retrieval database ID. |
| `database-slug` | One of | - | Retrieval database slug, resolved through the list endpoint. |
| `base-url` | No | `https://api.qdiv0.com` | QDivZero API base URL. |
| `paths` | No | all tracked `.md` | Newline-separated include globs. |
| `exclude` | No | - | Newline-separated exclude globs. |
| `batch-size` | No | `50` | Documents per `index-direct` request. |
| `max-chunk-chars` | No | `4000` | Maximum characters per grouped chunk. |

## Outputs

| Output | Description |
| --- | --- |
| `database-id` | Resolved Retrieval database ID. |
| `files` | Markdown files scanned. |
| `chunks` | Indexable chunks generated. |
| `indexed` | Documents accepted by the API. |
| `skipped` | Empty chunks skipped. |

## How it works

- Enumerates tracked Markdown with `git ls-files`.
- Splits Markdown by H1-H3 headings, ignoring headings inside fenced code blocks.
- Groups sections until `max-chunk-chars`; oversized sections are sent whole.
- Uses `md5(relative_path):chunk_index` as the document ID.
- Sends sequential batches to `index-direct` with retries on 429/5xx/network
  errors.
- Publishes a step summary and the outputs above.

## Limitations

- Upsert only. Deleting or renaming Markdown files can leave stale documents in
  the database.
- If multiple repositories share one database, identical relative paths produce
  identical document IDs. Use one database per repository.
- Setext headings are not recognized.
- Sections larger than `max-chunk-chars` are sent whole and may be rejected by
  the API or embedding model.

## Repository access

This repository is private. Authorized caller repositories must be able to use
private actions and reusable workflows from the QDivZero organization.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test
```

`dist/index.cjs` is committed. Rebuild and commit it whenever `src/` changes.

```bash
npm run build && git diff --exit-code -- dist
```
