import { beforeAll, describe, expect, it } from "vitest";

let wpr: any;

beforeAll(async () => {
  wpr = await import("../scripts/process-registry-mcp.mjs");
});

function skill(slug: string, name = slug) {
  return {
    slug,
    name,
    object_type: "skill",
    status: "draft",
    version: 1,
    description: "HMM entropy stock analysis",
    tags: [],
    config: {},
  };
}

const hmmMetadata = {
  trigger_terms: ["hmm", "entropy"],
  routing_keywords: ["hmm", "entropy", "stock"],
  operation_hints: {},
};

describe("WPR routing helpers", () => {
  it("builds resolver run inputs with ticker, operation query, and source", () => {
    expect(
      wpr.buildRunInputs("aapl", "price structure", "resolve_operation_path")
    ).toEqual({
      ticker: "AAPL",
      operation_query: "price structure",
      source: "resolve_operation_path",
    });
  });

  it("reports missing required inputs from operation metadata", () => {
    const item = skill("schema-first-stock-analysis");
    const metadata = {
      input_schema: {
        type: "object",
        required: ["ticker", "horizon"],
      },
    };

    expect(wpr.getMissingRequiredInputs(item, { ticker: "AAPL" }, metadata)).toEqual([
      "horizon",
    ]);
  });

  it("also respects template required_inputs", () => {
    const item = {
      ...skill("company-research-template"),
      object_type: "template",
      config: { required_inputs: ["ticker", "audience", "depth"] },
    };

    expect(wpr.getMissingRequiredInputs(item, { ticker: "MSFT" }, null)).toEqual([
      "audience",
      "depth",
    ]);
  });

  it("validates input types from operation metadata schemas", () => {
    const item = skill("schema-first-stock-analysis");
    const metadata = {
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
          horizon_days: { type: "integer", minimum: 1 },
        },
        required: ["ticker"],
      },
    };

    expect(() =>
      wpr.validateProcessRunInputs(
        item,
        { ticker: "AAPL", horizon_days: "30" },
        metadata
      )
    ).toThrow("inputs.horizon_days must be integer");
  });

  it("rejects unknown inputs when schemas disable additional properties", () => {
    const item = skill("price-structure-analysis");
    const metadata = {
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticker: { type: "string" },
        },
        required: ["ticker"],
      },
    };

    expect(() =>
      wpr.validateProcessRunInputs(item, { ticker: "AAPL", surprise: true }, metadata)
    ).toThrow("inputs.surprise is not allowed");
  });

  it("accepts anyOf argument shapes for event-driven skills", () => {
    const item = skill("polymarket-distiller");
    const metadata = {
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          slug: { type: "string" },
        },
        anyOf: [{ required: ["query"] }, { required: ["slug"] }],
      },
    };

    expect(() =>
      wpr.validateProcessRunInputs(item, { slug: "democratic-presidential-nominee-2028" }, metadata)
    ).not.toThrow();
    expect(() =>
      wpr.validateProcessRunInputs(item, {}, metadata)
    ).toThrow("must satisfy at least one argument shape");
  });

  it("prefers analysis over backtest unless the query asks for backtest", () => {
    const analysis = skill("hmm-entropy-analysis");
    const backtest = skill("backtest-hmm-entropy");

    expect(wpr.operationMatchScore(analysis, hmmMetadata, "hmm entropy")).toBeGreaterThan(
      wpr.operationMatchScore(backtest, hmmMetadata, "hmm entropy")
    );
    expect(
      wpr.operationMatchScore(backtest, hmmMetadata, "backtest hmm entropy")
    ).toBeGreaterThan(
      wpr.operationMatchScore(analysis, hmmMetadata, "backtest hmm entropy")
    );
  });

  it("classifies verdict-style skill outputs as decision artifacts", () => {
    expect(wpr.inferArtifactTypes("Price Structure Verdict and trading implication")).toContain(
      "decision_memo"
    );
  });

  it("exposes built-in runner metadata for executable skills", () => {
    expect(wpr.getBuiltInRunnerInfo("price-structure-analysis")).toMatchObject({
      artifact_type: "price_structure_verdict",
      smoke_inputs: { ticker: "AAPL" },
    });
    expect(wpr.getBuiltInRunnerInfo("polymarket-distiller")).toMatchObject({
      artifact_type: "polymarket_distillation",
      smoke_inputs: { slug: "democratic-presidential-nominee-2028" },
    });
    expect(wpr.getBuiltInRunnerInfo("hmm-entropy-analysis")).toBeNull();
  });

  it("provides a generic safe runner for imported skills without built-ins", () => {
    expect(wpr.getRunnerInfo({ slug: "hmm-entropy-analysis", object_type: "skill" })).toMatchObject({
      runner_kind: "generic",
      artifact_type: "skill_invocation_packet",
    });
    expect(wpr.getRunnerInfo({ slug: "daily-watchlist-operating-loop", object_type: "process" })).toBeNull();
  });

  it("imports new skills with WPR-ready typed input schemas", () => {
    const item = {
      ...skill("new-example-skill"),
      config: {
        source_path: "/tmp/new-example-skill/SKILL.md",
        source_slug: "new-example-skill",
      },
    };
    const metadata = wpr.buildSkillOperationMetadata(
      item,
      "# New Example Skill\nUse this skill when testing WPR imports.",
      { name: "new-example-skill" }
    );

    expect(metadata.input_schema.inferred).toBeUndefined();
    expect(metadata.input_schema).toMatchObject({
      type: "object",
      properties: {
        input: { type: "string" },
        dry_run: { type: "boolean" },
      },
    });
  });
});
