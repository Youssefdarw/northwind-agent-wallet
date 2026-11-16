import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AskError, MAX_QUESTION_CHARS, askAgent } from "./ask.js";

describe("Ask the agent", () => {
  it("has no tools and can't reach keys, mandates or the executor", () => {
    const src = readFileSync(new URL("./ask.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/tools:|loadPrivateKey|privateKeyToAccount|executor\/|payMandate|issueMandate|proposePayment|approveHeld|savePolicy/);
  });

  it("rejects empty and over-long questions before calling Claude", async () => {
    await expect(askAgent("   ", [], {})).rejects.toBeInstanceOf(AskError);
    await expect(askAgent("x".repeat(MAX_QUESTION_CHARS + 1), [], {})).rejects.toThrow(/under 600/);
  });
});
