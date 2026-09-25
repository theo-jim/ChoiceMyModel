import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageError, formatDecision, parseArgs, shellQuote } from "../src/cli.js";
import type { RoutingDecision } from "../src/types.js";

const NO_ENV = {} as NodeJS.ProcessEnv;

test("parseArgs collects task words and defaults", () => {
  const args = parseArgs(["Fix", "the", "flaky", "auth", "test"], NO_ENV);
  assert.equal(args.text, "Fix the flaky auth test");
  assert.equal(args.shell, false);
  assert.equal(args.kind, undefined);
  assert.equal(args.context, undefined);
});

test("parseArgs reads --kind, --context and --shell", () => {
  const args = parseArgs(
    ["--kind", "codex", "--context", "repo: payments", "--shell", "Add", "a", "test"],
    NO_ENV,
  );
  assert.equal(args.kind, "codex");
  assert.equal(args.context, "repo: payments");
  assert.equal(args.shell, true);
  assert.equal(args.text, "Add a test");
});

test("parseArgs falls back to HERD_KIND from the environment", () => {
  const args = parseArgs(["Do", "a", "thing"], { HERD_KIND: "codex" } as NodeJS.ProcessEnv);
  assert.equal(args.kind, "codex");
});

test("parseArgs rejects a trailing --kind with no value", () => {
  assert.throws(() => parseArgs(["Do", "a", "thing", "--kind"], NO_ENV), UsageError);
});

test("parseArgs rejects an unknown --kind value", () => {
  assert.throws(() => parseArgs(["--kind", "gemini", "Do", "it"], NO_ENV), /invalid --kind/);
});

test("parseArgs requires task text", () => {
  assert.throws(() => parseArgs(["--shell"], NO_ENV), UsageError);
});

test("shellQuote escapes embedded single quotes for eval", () => {
  assert.equal(shellQuote("it's fine"), `'it'\\''s fine'`);
});

function decision(): RoutingDecision {
  return {
    tier: "mid",
    worker: {
      kind: "claude",
      model: "claude-sonnet-5",
      args: "--model claude-sonnet-5 --permission-mode acceptEdits",
    },
    classification: {
      useCase: "implement",
      useCaseConfidence: 0.9,
      spansMultipleSystems: 0,
      hardToReverse: 0,
      solutionShape: 0.5,
      executionScope: "local_write",
      backend: "jev",
      latencyMs: 100,
    },
    escalated: false,
    reasons: [],
  };
}

test("formatDecision renders eval-able shell assignments with --shell", () => {
  const out = formatDecision(decision(), true);
  assert.equal(
    out,
    "HERD_KIND=claude\nHERD_ARGS='--model claude-sonnet-5 --permission-mode acceptEdits'",
  );
});

test("formatDecision renders JSON without --shell", () => {
  const out = formatDecision(decision(), false);
  assert.equal(JSON.parse(out).tier, "mid");
});
