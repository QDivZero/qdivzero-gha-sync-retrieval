import { describe, expect, it } from "vitest";
import { InputError, readGitHubContext, readInputs } from "../src/inputs.js";

const baseEnv = {
  "INPUT_API-KEY": "tk_test.secret",
  "INPUT_DATABASE-ID": "db_123",
  "INPUT_BASE-URL": "https://api.qdiv0.com/",
  "INPUT_PATHS": "docs/**/*.md\nREADME.md\n\n",
  "INPUT_EXCLUDE": "docs/private/**",
  "INPUT_BATCH-SIZE": "25",
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
    });
  });

  it("applies defaults", () => {
    const inputs = readInputs({ "INPUT_API-KEY": "key", "INPUT_DATABASE-SLUG": "docs" });
    expect(inputs.baseUrl).toBe("https://api.qdiv0.com");
    expect(inputs.paths).toEqual([]);
    expect(inputs.exclude).toEqual([]);
    expect(inputs.batchSize).toBe(50);
    expect(inputs.databaseSlug).toBe("docs");
  });

  it("rejects a missing API key", () => {
    expect(() => readInputs({ "INPUT_DATABASE-ID": "db" })).toThrow(InputError);
  });

  it("rejects both database identifiers", () => {
    expect(() => readInputs({ ...baseEnv, "INPUT_DATABASE-SLUG": "docs" })).toThrow(/exactly one/i);
  });

  it("rejects neither database identifier", () => {
    const { "INPUT_DATABASE-ID": _databaseId, ...env } = baseEnv;
    expect(() => readInputs(env)).toThrow(/exactly one/i);
  });

  it("rejects invalid numeric inputs", () => {
    expect(() => readInputs({ ...baseEnv, "INPUT_BATCH-SIZE": "0" })).toThrow(/batch-size/i);
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
