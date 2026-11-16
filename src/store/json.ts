/** Tiny JSON-file persistence for the demo (data/ is gitignored). Atomic writes via rename. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = resolve(process.env.DATA_DIR || resolve(process.cwd(), "data"));

/**
 * Saved evidence of past runs (docs/sample-run). The app may read these files but must
 * never write, overwrite or delete them, whatever DATA_DIR or a script argument says.
 * Located from this file, not the working directory, so it holds wherever a command runs.
 */
export const PROTECTED_DIRS: readonly string[] = [
  resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "sample-run"),
];

const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Throws if writing to `path` would touch a protected folder. */
export function assertWritable(path: string): void {
  const p = resolve(path);
  const hit = PROTECTED_DIRS.find((dir) => isInside(p, dir));
  if (hit) throw new Error(`Refusing to write ${p}: ${hit} holds saved sample runs and is read-only.`);
}

/** Throws if deleting the folder `dir` would delete a protected folder (it is one, is inside one, or contains one). */
export function assertDeletable(dir: string): void {
  const d = resolve(dir);
  const hit = PROTECTED_DIRS.find((p) => isInside(d, p) || isInside(p, d));
  if (hit) throw new Error(`Refusing to delete ${d}: it would remove ${hit}, which holds saved sample runs.`);
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  assertWritable(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}
