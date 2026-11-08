import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { minimatch } from "minimatch";

const execFileAsync = promisify(execFile);

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
    .filter((file) => {
      const included = include.length === 0 || include.some((pattern) => minimatch(file, pattern, { dot: true }));
      if (!included) return false;
      return !exclude.some((pattern) => minimatch(file, pattern, { dot: true }));
    })
    .sort();
}
