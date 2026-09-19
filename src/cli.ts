#!/usr/bin/env node
import { chooseModel } from "./chooseModel.js";
import type { AgentKind } from "./types.js";

function usage(): never {
  console.error(
    `usage: choicemymodel [--kind claude|codex] [--context <text>] [--shell] <task text>

Picks the herd-spawn worker for a task. Prints JSON (default) or eval-able
shell assignments (--shell).

  choicemymodel "Fix the flaky auth test"
  eval "$(choicemymodel --shell "Review the auth diff")"
  herd-spawn -k "$HERD_KIND" -a "$HERD_ARGS" review-auth ~/proj "Review the auth diff"`,
  );
  process.exit(2);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const argv = process.argv.slice(2);
let kind: AgentKind | undefined;
let context: string | undefined;
let shell = false;
const words: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--kind") kind = argv[++i] as AgentKind;
  else if (arg === "--context") context = argv[++i];
  else if (arg === "--shell") shell = true;
  else if (arg === "-h" || arg === "--help") usage();
  else words.push(arg);
}

const text = words.join(" ").trim();
if (!text) usage();

kind ??= process.env.HERD_KIND as AgentKind | undefined;
if (kind !== undefined && kind !== "claude" && kind !== "codex") usage();

const decision = await chooseModel({ text, context }, { kind });

if (shell) {
  console.log(`HERD_KIND=${decision.worker.kind}`);
  console.log(`HERD_ARGS=${shellQuote(decision.worker.args)}`);
} else {
  console.log(JSON.stringify(decision, null, 2));
}
