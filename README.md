# qdivzero-gha-sync-retrieval

GitHub Action that syncs tracked Markdown files from a repository into a
QDivZero Retrieval database.

The action sends one document per file. The Retrieval API handles heading
detection, chunking, chunk IDs, and per-document chunk replacement.

## Releases

- `@v1`: current major release. Recommended for normal use.
- `@v1.0.0`: immutable release.

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
      - uses: QDivZero/qdivzero-gha-sync-retrieval@v1
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

## Outputs

| Output | Description |
| --- | --- |
| `database-id` | Resolved Retrieval database ID. |
| `files` | Markdown files scanned. |
| `documents` | Documents sent to the API. |
| `indexed` | Documents accepted by the API. |

## How it works

- Enumerates tracked Markdown with `git ls-files`.
- Sends one document per file with `id = md5(relative_path)` and the full
  Markdown content.
- Adds file-level metadata: action, repository, path, ref, commit, title, and
  URL.
- The Retrieval API handles heading detection, chunking, and chunk IDs.
- Re-indexing the same document replaces its previous chunks.
- Empty files are skipped.
- Sends sequential batches to `index-direct` with retries on 429/5xx/network
  errors.
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

- Deleting or renaming Markdown files can leave stale documents in the database
  because the action does not delete documents.
- If multiple repositories share one database, identical relative paths produce
  identical document IDs. Use one database per repository.
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
