import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildTools } from "./tools.js";

const TOOLS = buildTools(["office_suite", "hosting"]);

// Guardrails on the agent's capability surface. If someone later adds a tool
// that lets the LLM pay or sign directly, these tests fail.

describe("Agent tool surface", () => {
  it("exposes exactly four tools, none of which can sign or pay directly", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["get_budget_status", "list_bills", "propose_payment", "request_approval"]);
  });

  it("propose_payment accepts only a bill id and reasoning: no amount, payee, network or call count", () => {
    const t = TOOLS.find((x) => x.name === "propose_payment")!;
    const schema = t.input_schema as unknown as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(schema.properties).sort()).toEqual(["bill_id", "reasoning"]);
    expect(schema.additionalProperties).toBe(false);
    expect(t.strict).toBe(true);
  });

  it("every tool is strict with additionalProperties: false", () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      expect((t.input_schema as unknown as { additionalProperties: boolean }).additionalProperties).toBe(false);
    }
  });

  it("agent code never touches private keys, the executor, or mandate signing", () => {
    const dir = join(process.cwd(), "src/agent");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"));
    for (const src of sources) {
      expect(src).not.toMatch(/loadPrivateKey|privateKeyToAccount|executor\/pay|payMandate|issueMandate|signMandate/);
    }
  });
});
