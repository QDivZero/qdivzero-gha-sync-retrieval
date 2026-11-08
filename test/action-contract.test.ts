import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("action contract", () => {
  it("declares the Node 24 entry point and required inputs", async () => {
    const action = parse(await readFile("action.yml", "utf8")) as {
      runs: { using: string; main: string };
      inputs: Record<string, { required?: boolean }>;
      outputs: Record<string, unknown>;
    };
    expect(action.runs.using).toBe("node24");
    expect(action.runs.main).toBe("dist/index.cjs");
    expect(action.inputs["api-key"]?.required).toBe(true);
    expect(action.inputs["database-id"]).toBeDefined();
    expect(action.inputs["database-slug"]).toBeDefined();
    expect(action.outputs["database-id"]).toBeDefined();
    expect(action.outputs.indexed).toBeDefined();
    expect(existsSync("dist/index.cjs")).toBe(true);
  });
});
