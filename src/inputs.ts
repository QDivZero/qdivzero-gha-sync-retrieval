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
  chunking?: { size: number; overlap: number };
  prune: boolean;
  removeLegacy: boolean;
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

export function versionedBaseUrl(raw: string): string {
  const url = new URL(normalizeBaseUrl(raw));
  if (url.search || url.hash) throw new InputError("Input base-url must not contain a query or fragment.");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = input(env, name).toLowerCase();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new InputError(`Input ${name} must be true or false.`);
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

  const rawChunkSize = input(env, "chunk-size");
  const rawOverlap = input(env, "chunk-overlap");
  if ((rawChunkSize === "") !== (rawOverlap === "")) {
    throw new InputError("Provide both chunk-size and chunk-overlap, or omit both.");
  }
  let chunking: ActionInputs["chunking"];
  if (rawChunkSize !== "") {
    const size = parseInteger(env, "chunk-size", 0, 1, 20000);
    const overlap = parseInteger(env, "chunk-overlap", 0, 0, 10000);
    if (overlap >= size || overlap > Math.floor(size / 2)) {
      throw new InputError("Input chunk-overlap must be less than the size and at most half of it.");
    }
    chunking = { size, overlap };
  }

  return {
    apiKey,
    databaseId,
    databaseSlug,
    baseUrl: normalizeBaseUrl(input(env, "base-url") || "https://api.qdiv0.com"),
    paths: parseLines(input(env, "paths")),
    exclude: parseLines(input(env, "exclude")),
    batchSize: parseInteger(env, "batch-size", 50, 1, 200),
    prune: parseBoolean(env, "prune"),
    removeLegacy: parseBoolean(env, "remove-legacy"),
    ...(chunking === undefined ? {} : { chunking }),
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
