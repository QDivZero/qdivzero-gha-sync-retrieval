export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export interface ActionInputs {
  apiKey: string;
  databaseId?: string;
  databaseSlug?: string;
  baseUrl: string;
  paths: string[];
  exclude: string[];
  batchSize: number;
  maxChunkChars: number;
}

export interface GitHubContext {
  workspace: string;
  repository: string;
  refName: string;
  sha: string;
  serverUrl: string;
}

function input(env: NodeJS.ProcessEnv, name: string): string {
  return (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = input(env, name);
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`Input ${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeBaseUrl(raw: string): string {
  const value = raw.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError(`Input base-url is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InputError("Input base-url must use http or https.");
  }
  return value;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = (env[name] ?? "").trim();
  if (value === "") throw new InputError(`Environment variable ${name} is required.`);
  return value;
}

export function readInputs(env: NodeJS.ProcessEnv = process.env): ActionInputs {
  const apiKey = input(env, "api-key");
  if (apiKey === "") throw new InputError("Input api-key is required.");

  const databaseId = input(env, "database-id") || undefined;
  const databaseSlug = input(env, "database-slug") || undefined;
  if ((databaseId ? 1 : 0) + (databaseSlug ? 1 : 0) !== 1) {
    throw new InputError("Provide exactly one of database-id or database-slug.");
  }

  return {
    apiKey,
    databaseId,
    databaseSlug,
    baseUrl: normalizeBaseUrl(input(env, "base-url") || "https://api.qdiv0.com"),
    paths: parseLines(input(env, "paths")),
    exclude: parseLines(input(env, "exclude")),
    batchSize: parseInteger(env, "batch-size", 50, 1, 200),
    maxChunkChars: parseInteger(env, "max-chunk-chars", 4000, 200, 1_000_000),
  };
}

export function readGitHubContext(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): GitHubContext {
  const workspace = (env.GITHUB_WORKSPACE ?? "").trim() || cwd;
  const serverUrl = ((env.GITHUB_SERVER_URL ?? "").trim() || "https://github.com").replace(/\/+$/, "");
  return {
    workspace,
    repository: requiredEnv(env, "GITHUB_REPOSITORY"),
    refName: requiredEnv(env, "GITHUB_REF_NAME"),
    sha: requiredEnv(env, "GITHUB_SHA"),
    serverUrl,
  };
}
