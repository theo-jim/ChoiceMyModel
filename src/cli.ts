#!/usr/bin/env node
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseModel } from "./chooseModel.js";
import { resolvePackagePath } from "./packageRoot.js";
import type { AgentKind, RoutingDecision } from "./types.js";

/**
 * The npm scripts (dev/start/test/eval) load .env via `node --env-file-if-exists`,
 * resolved against the cwd they're invoked from (the project root). The published
 * `bin` entry has no such flag and is invoked as a global binary from arbitrary
 * cwds (e.g. by herd-spawn), so .env must be resolved against the package
 * directory itself, not process.cwd().
 */
function loadPackageEnvFile(): void {
  const envPath = resolvePackagePath(".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const USAGE = `usage: choicemymodel [--kind claude|codex] [--context <text>] [--shell] <task text>

Picks the herd-spawn worker for a task. Prints JSON (default) or eval-able
shell assignments (--shell).

  choicemymodel "Fix the flaky auth test"
  eval "$(choicemymodel --shell "Review the auth diff")"
  herd-spawn -k "$HERD_KIND" -a "$HERD_ARGS" review-auth ~/proj "Review the auth diff"`;

/** Thrown for any bad invocation; the entry point turns it into a usage message + exit 2. */
export class UsageError extends Error {}

export interface CliArgs {
  kind?: AgentKind;
  context?: string;
  shell: boolean;
  text: string;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Parse argv (without node/script). Missing values for a flag are a usage
 * error rather than silently becoming undefined, so a trailing `--kind` with no
 * value is caught instead of falling through to the env default.
 */
export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliArgs {
  let kind: AgentKind | undefined;
  let context: string | undefined;
  let shell = false;
  const words: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--kind") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError("--kind requires a value");
      kind = value as AgentKind;
    } else if (arg === "--context") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError("--context requires a value");
      context = value;
    } else if (arg === "--shell") {
      shell = true;
    } else if (arg === "-h" || arg === "--help") {
      throw new UsageError();
    } else {
      words.push(arg);
    }
  }

  const text = words.join(" ").trim();
  if (!text) throw new UsageError("a task description is required");

  kind ??= (env.HERD_KIND || undefined) as AgentKind | undefined;
  if (kind !== undefined && kind !== "claude" && kind !== "codex") {
    throw new UsageError(`invalid --kind "${kind}" (expected "claude" or "codex")`);
  }

  return { kind, context, shell, text };
}

export function formatDecision(decision: RoutingDecision, shell: boolean): string {
  if (shell) {
    return `HERD_KIND=${decision.worker.kind}\nHERD_ARGS=${shellQuote(decision.worker.args)}`;
  }
  return JSON.stringify(decision, null, 2);
}

function newestMtimeMs(dir: string, extension: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true })) {
    if (typeof entry !== "string" || extname(entry) !== extension) continue;
    const mtime = statSync(resolve(dir, entry)).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * dist/ is gitignored and the global `choicemymodel` bin symlinks straight
 * into it, so a routing change landed in src/ but never rebuilt leaves
 * `git status` clean while the binary keeps routing on stale, hardcoded
 * output (this bit us: a model-id refactor sat in src/ while dist/ kept
 * routing frontier tasks to a pinned "claude-opus-5" for weeks). Fail loud
 * instead of silently running outdated routing logic.
 *
 * srcDir/distFile are parameterized for testability; real callers rely on
 * the defaults.
 */
export function checkBuildFreshness(
  srcDir: string = resolvePackagePath("src"),
  distFile: string = fileURLToPath(import.meta.url),
): string | undefined {
  if (!existsSync(srcDir)) return undefined; // published without src/ alongside dist/: not this dev layout

  const newestSrcMtime = newestMtimeMs(srcDir, ".ts");
  const distMtime = statSync(distFile).mtimeMs;
  if (newestSrcMtime <= distMtime) return undefined;

  return (
    "choicemymodel: dist/ is stale — src/ changed after the last build.\n" +
    "Run `npm run build` in the package directory, then retry."
  );
}

async function main(): Promise<void> {
  const staleWarning = checkBuildFreshness();
  if (staleWarning !== undefined) {
    console.error(staleWarning);
    process.exit(3);
  }

  loadPackageEnvFile();

  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      if (err.message) console.error(err.message);
      console.error(USAGE);
      process.exit(2);
    }
    throw err;
  }

  const decision = await chooseModel(
    { text: args.text, context: args.context },
    { kind: args.kind },
  );
  console.log(formatDecision(decision, args.shell));
}

/**
 * Comparing raw strings (`import.meta.url === file://${process.argv[1]}`)
 * breaks when the CLI is invoked through a symlink — e.g. an `npm link`
 * global install — because import.meta.url resolves to the real file path
 * while argv[1] keeps the symlink path. Resolve both to real paths first.
 */
function isMainModule(): boolean {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main();
}
