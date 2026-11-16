import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PROTECTED_DIRS, assertDeletable, assertWritable, writeJson } from "./json.js";
import { WALLET_ROLES } from "../config/wallets.js";

const SAMPLE_RUN = PROTECTED_DIRS[0]!;
const ROOT = resolve(SAMPLE_RUN, "..", "..");

/** Fingerprint of every file in docs/sample-run, so a test can prove nothing changed. */
const fingerprint = () =>
  readdirSync(SAMPLE_RUN)
    .sort()
    .map((f) => `${f}:${createHash("sha256").update(readFileSync(join(SAMPLE_RUN, f))).digest("hex")}`)
    .join("\n");

/** Placeholder wallet addresses, so the test runs on a fresh clone with no .env (reset only needs addresses, never keys). */
const PLACEHOLDER_ADDRESSES = Object.fromEntries(
  WALLET_ROLES.map((r, i) => [`${r.env}_ADDRESS`, `0x${(i + 1).toString(16).padStart(40, "0")}`]),
);

/** Runs `npm run reset`'s script for real, with the given DATA_DIR. */
const runReset = (dataDir: string) =>
  execFileSync(resolve(ROOT, "node_modules/.bin/tsx"), ["scripts/reset.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...PLACEHOLDER_ADDRESSES, DATA_DIR: dataDir },
    encoding: "utf8",
    stdio: "pipe",
  });

describe("docs/sample-run is protected", () => {
  it("holds the saved 15 Nov run", () => {
    expect(existsSync(join(SAMPLE_RUN, "ledger-2026-11-15.json"))).toBe(true);
  });

  it("writeJson refuses to write into it, and the file is unchanged", () => {
    const before = fingerprint();
    expect(() => writeJson(join(SAMPLE_RUN, "ledger-2026-11-15.json"), {})).toThrow(/read-only/);
    expect(() => writeJson(join(SAMPLE_RUN, "nested", "x.json"), {})).toThrow(/read-only/);
    expect(fingerprint()).toBe(before);
  });

  it("writeJson still works everywhere else", () => {
    const dir = mkdtempSync(join(tmpdir(), "nw-json-"));
    writeJson(join(dir, "ok.json"), { ok: true });
    expect(JSON.parse(readFileSync(join(dir, "ok.json"), "utf8"))).toEqual({ ok: true });
    expect(() => assertWritable(join(ROOT, "docs", "sample-run-other", "x.json"))).not.toThrow();
  });

  it("refuses to delete it, a folder inside it, or a folder that contains it", () => {
    expect(() => assertDeletable(SAMPLE_RUN)).toThrow(/sample runs/);
    expect(() => assertDeletable(join(SAMPLE_RUN, "sub"))).toThrow(/sample runs/);
    expect(() => assertDeletable(join(ROOT, "docs"))).toThrow(/sample runs/);
    expect(() => assertDeletable(ROOT)).toThrow(/sample runs/);
    expect(() => assertDeletable(join(ROOT, "share"))).not.toThrow();
  });

  it("npm run reset clears a normal data folder and leaves docs/sample-run untouched", () => {
    const before = fingerprint();
    const dir = mkdtempSync(join(tmpdir(), "nw-reset-"));
    const out = runReset(dir);
    expect(out).toMatch(/Saved sample runs in docs\/sample-run kept/);
    expect(JSON.parse(readFileSync(join(dir, "mandates.json"), "utf8"))).toEqual([]);
    expect(fingerprint()).toBe(before);
  }, 30_000);

  it("npm run reset refuses when DATA_DIR points at docs/sample-run, and changes nothing", () => {
    const before = fingerprint();
    let failed = false;
    try {
      runReset(SAMPLE_RUN);
    } catch (err) {
      failed = true;
      expect(String((err as { stderr?: string }).stderr)).toMatch(/Nothing was reset/);
    }
    expect(failed).toBe(true);
    expect(fingerprint()).toBe(before);
    expect(readdirSync(SAMPLE_RUN)).toEqual(["ledger-2026-11-15.json"]);
  }, 30_000);
});
