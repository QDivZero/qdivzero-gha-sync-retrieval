import { execFile as execFileCallback, spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
let server: Server;
let repoDir: string;
let outputFile: string;
let summaryFile: string;
let baseUrl: string;
const requests: Array<{ path: string; body: unknown; authorization: string | undefined }> = [];

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw === "" ? undefined : JSON.parse(raw);
    requests.push({
      path: request.url ?? "",
      body,
      authorization: request.headers.authorization,
    });

    if (request.method === "GET" && request.url === "/flexible-vector-databases") {
      json(response, 200, { databases: [{ id: "db_e2e", slug: "e2e-docs" }] });
      return;
    }
    if (request.method === "POST" && request.url === "/flexible-vector-databases/db_e2e/index-direct") {
      json(response, 200, { indexed: (body as { documents?: unknown[] }).documents?.length ?? 0 });
      return;
    }
    json(response, 404, { message: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;

  repoDir = await mkdtemp(join(tmpdir(), "qd-e2e-"));
  await execFile("git", ["init", "-q", repoDir]);
  await mkdir(join(repoDir, "docs"), { recursive: true });
  await writeFile(
    join(repoDir, "README.md"),
    "# Readme\n\nIntro.\n\n## Usage\n\nRun it.\n",
  );
  await writeFile(
    join(repoDir, "docs", "guide.md"),
    "# Guide\n\n## Install\n\n```sh\n# not a heading\necho hi\n```\n\n## Use\n\nBody.\n",
  );
  await execFile("git", ["-C", repoDir, "add", "README.md", "docs"]);

  outputFile = join(repoDir, "github-output.txt");
  summaryFile = join(repoDir, "github-summary.md");
  await writeFile(outputFile, "");
  await writeFile(summaryFile, "");
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(repoDir, { recursive: true, force: true });
});

function runAction(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "dist/index.cjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        "INPUT_API-KEY": "tk_e2e.secret",
        "INPUT_DATABASE-SLUG": "e2e-docs",
        "INPUT_BASE-URL": baseUrl,
        "INPUT_BATCH-SIZE": "1",
        "INPUT_MAX-CHUNK-CHARS": "200",
        GITHUB_WORKSPACE: repoDir,
        GITHUB_REPOSITORY: "QDivZero/e2e-fixture",
        GITHUB_REF_NAME: "main",
        GITHUB_SHA: "abc123",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("action end to end", () => {
  it("resolves the slug, indexes batches, and publishes outputs", async () => {
    const result = await runAction();
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("tk_e2e.secret");
    expect(result.stdout).toContain("Indexing batch 1/");

    const listCall = requests.find((request) => request.path === "/flexible-vector-databases");
    expect(listCall?.authorization).toBe("Bearer tk_e2e.secret");

    const indexCalls = requests.filter((request) => request.path.endsWith("/index-direct"));
    expect(indexCalls.length).toBeGreaterThan(1);
    expect(indexCalls.every((call) => call.authorization === "Bearer tk_e2e.secret")).toBe(true);

    const documents = indexCalls.flatMap((call) => (call.body as { documents: unknown[] }).documents);
    expect(documents.length).toBeGreaterThanOrEqual(2);
    expect(documents[0]).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{32}:\d+$/),
      metadata: {
        repo: "QDivZero/e2e-fixture",
        ref: "main",
        commit: "abc123",
      },
    });

    const outputs = await readFile(outputFile, "utf8");
    expect(outputs).toContain("database-id<<");
    expect(outputs).toContain("db_e2e");
    expect(outputs).toContain("indexed<<");

    const summary = await readFile(summaryFile, "utf8");
    expect(summary).toContain("QDivZero Retrieval sync");
    expect(summary).toContain("db_e2e");
  });
});
