import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { minimatch } from "minimatch";

const execFileAsync = promisify(execFile);

export function matchesMarkdownPath(file: string, include: string[], exclude: string[]): boolean {
  if (!/\.md$/i.test(file)) return false;
  const included = include.length === 0 || include.some((pattern) => minimatch(file, pattern, { dot: true }));
  return included && !exclude.some((pattern) => minimatch(file, pattern, { dot: true }));
}

export async function listTrackedMarkdown(
  workspace: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  let stdout: string;
  try {
    const result = await execFileAsync("git", ["-C", workspace, "ls-files", "-z"], {
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to list tracked files in ${workspace}: ${message}`);
  }

  return stdout
    .split("\0")
    .filter((file) => file.length > 0 && /\.md$/i.test(file))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => matchesMarkdownPath(file, include, exclude))
    .sort();
}
