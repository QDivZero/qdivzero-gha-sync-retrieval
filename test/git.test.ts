import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { listTrackedMarkdown } from "../src/git.js";

const execFileAsync = promisify(execFile);
let repo: string | undefined;

async function createRepo(): Promise<string> {
  repo = await mkdtemp(join(tmpdir(), "qd-git-"));
  await execFileAsync("git", ["init", "-q", repo]);
  await mkdir(join(repo, "docs", "private"), { recursive: true });
  await mkdir(join(repo, ".github"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Readme\n");
  await writeFile(join(repo, "docs", "guide.md"), "# Guide\n");
  await writeFile(join(repo, "docs", "private", "secret.md"), "# Secret\n");
  await writeFile(join(repo, ".github", "notes.md"), "# Notes\n");
  await writeFile(join(repo, "untracked.md"), "# Untracked\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md", "docs", ".github"]);
  return repo;
}

afterEach(async () => {
  if (repo !== undefined) {
    await rm(repo, { recursive: true, force: true });
    repo = undefined;
  }
});

describe("listTrackedMarkdown", () => {
  it("lists tracked markdown only", async () => {
    const root = await createRepo();
    const files = await listTrackedMarkdown(root, [], []);
    expect(files).toEqual([".github/notes.md", "README.md", "docs/guide.md", "docs/private/secret.md"]);
  });

  it("applies include and exclude globs", async () => {
    const root = await createRepo();
    const files = await listTrackedMarkdown(root, ["docs/**"], ["docs/private/**"]);
    expect(files).toEqual(["docs/guide.md"]);
  });

  it("fails outside a git checkout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qd-not-git-"));
    await expect(listTrackedMarkdown(dir, [], [])).rejects.toThrow(/tracked files/i);
    await rm(dir, { recursive: true, force: true });
  });
});
