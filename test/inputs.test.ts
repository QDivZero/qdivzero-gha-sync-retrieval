import { describe, expect, it } from "vitest";
import { InputError, readGitHubContext, readInputs } from "../src/inputs.js";

const baseEnv = {
  "INPUT_API-KEY": "tk_test.secret",
  "INPUT_DATABASE-ID": "db_123",
  "INPUT_BASE-URL": "https://api.qdiv0.com/",
  "INPUT_PATHS": "docs/**/*.md\nREADME.md\n\n",
  "INPUT_EXCLUDE": "docs/private/**",
  "INPUT_BATCH-SIZE": "25",
  "INPUT_MAX-CHUNK-CHARS": "3000",
};

describe("readInputs", () => {
  it("parses defaults and multiline patterns", () => {
    const inputs = readInputs(baseEnv);
    expect(inputs).toEqual({
      apiKey: "tk_test.secret",
      databaseId: "db_123",
      databaseSlug: undefined,
      baseUrl: "https://api.qdiv0.com",
      paths: ["docs/**/*.md", "README.md"],
      exclude: ["docs/private/**"],
      batchSize: 25,
      maxChunkChars: 3000,
    });
  });

  it("applies defaults", () => {
    const inputs = readInputs({ "INPUT_API-KEY": "key", "INPUT_DATABASE-SLUG": "docs" });
    expect(inputs.baseUrl).toBe("https://api.qdiv0.com");
    expect(inputs.paths).toEqual([]);
    expect(inputs.exclude).toEqual([]);
    expect(inputs.batchSize).toBe(50);
    expect(inputs.maxChunkChars).toBe(4000);
    expect(inputs.databaseSlug).toBe("docs");
  });

  it("rejects a missing API key", () => {
    expect(() => readInputs({ "INPUT_DATABASE-ID": "db" })).toThrow(InputError);
  });

  it("rejects both database identifiers", () => {
    expect(() => readInputs({ ...baseEnv, "INPUT_DATABASE-SLUG": "docs" })).toThrow(/exactly one/i);
  });

  it("rejects neither database identifier", () => {
    const env = { ...baseEnv };
    delete env["INPUT_DATABASE-ID"];
    expect(() => readInputs(env)).toThrow(/exactly one/i);
  });

  it("rejects invalid numeric inputs", () => {
    expect(() => readInputs({ ...baseEnv, "INPUT_BATCH-SIZE": "0" })).toThrow(/batch-size/i);
    expect(() => readInputs({ ...baseEnv, "INPUT_MAX-CHUNK-CHARS": "199" })).toThrow(/max-chunk-chars/i);
  });

  it("rejects invalid base URLs", () => {
    expect(() => readInputs({ ...baseEnv, "INPUT_BASE-URL": "ftp://example.com" })).toThrow(/http/i);
    expect(() => readInputs({ ...baseEnv, "INPUT_BASE-URL": "not a url" })).toThrow(/valid URL/i);
  });
});

describe("readGitHubContext", () => {
  it("reads required GitHub environment values", () => {
    const context = readGitHubContext(
      {
        GITHUB_WORKSPACE: "/repo",
        GITHUB_REPOSITORY: "QDivZero/example",
        GITHUB_REF_NAME: "main",
        GITHUB_SHA: "abc123",
        GITHUB_SERVER_URL: "https://github.com/",
      },
      "/fallback",
    );
    expect(context).toEqual({
      workspace: "/repo",
      repository: "QDivZero/example",
      refName: "main",
      sha: "abc123",
      serverUrl: "https://github.com",
    });
  });

  it("falls back to cwd and the public GitHub URL", () => {
    const context = readGitHubContext(
      {
        GITHUB_REPOSITORY: "QDivZero/example",
        GITHUB_REF_NAME: "main",
        GITHUB_SHA: "abc123",
      },
      "/fallback",
    );
    expect(context.workspace).toBe("/fallback");
    expect(context.serverUrl).toBe("https://github.com");
  });

  it("rejects missing required values", () => {
    expect(() => readGitHubContext({}, "/fallback")).toThrow(/GITHUB_REPOSITORY/i);
  });
});
