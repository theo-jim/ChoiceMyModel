import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  UsageError,
  checkBuildFreshness,
  formatDecision,
  parseArgs,
  shellQuote,
} from "../src/cli.js";
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
      reasoningDemand: "bounded",
      reasoningDemandConfidence: 0.9,
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

function withFreshnessFixture(
  run: (srcDir: string, distFile: string, touchSrc: () => void) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "choicemymodel-freshness-"));
  try {
    const srcDir = join(root, "src");
    const distFile = join(root, "cli.js");
    mkdirSync(srcDir);
    const srcFile = join(srcDir, "routingTable.ts");
    writeFileSync(srcFile, "export {};");
    writeFileSync(distFile, "export {};");

    const base = new Date("2026-01-01T00:00:00Z");
    utimesSync(srcFile, base, base);
    utimesSync(distFile, base, base);

    run(srcDir, distFile, () => {
      const later = new Date(base.getTime() + 60_000);
      utimesSync(srcFile, later, later);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("checkBuildFreshness passes when dist is at least as new as src", () => {
  withFreshnessFixture((srcDir, distFile) => {
    assert.equal(checkBuildFreshness(srcDir, distFile), undefined);
  });
});

test("checkBuildFreshness fails loud when src changed after the last build", () => {
  withFreshnessFixture((srcDir, distFile, touchSrc) => {
    touchSrc();
    const warning = checkBuildFreshness(srcDir, distFile);
    assert.match(warning ?? "", /dist\/ is stale/);
    assert.match(warning ?? "", /npm run build/);
  });
});

test("checkBuildFreshness skips when there is no src/ next to dist (published layout)", () => {
  const root = mkdtempSync(join(tmpdir(), "choicemymodel-freshness-"));
  try {
    const distFile = join(root, "cli.js");
    writeFileSync(distFile, "export {};");
    assert.equal(checkBuildFreshness(join(root, "src"), distFile), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
