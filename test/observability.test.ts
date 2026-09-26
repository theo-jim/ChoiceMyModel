import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chooseModel } from "../src/chooseModel.js";
import { logDecision } from "../src/observability/log.js";
import { promoteDecision } from "../src/observability/promote.js";
import type { RoutingDecision } from "../src/types.js";

function fakeDecision(): RoutingDecision {
  return {
    tier: "mid",
    worker: { kind: "claude", model: "claude-sonnet-5", args: "--model claude-sonnet-5" },
    classification: {
      useCase: "implement",
      useCaseConfidence: 0.9,
      useCaseProbabilities: { implement: 0.9, other: 0.1 },
      spansMultipleSystems: 0.1,
      hardToReverse: 0.2,
      solutionShape: 0.5,
      executionScope: "local_write",
      reasoningDemand: "bounded",
      reasoningDemandConfidence: 0.9,
      backend: "jev",
      latencyMs: 12,
    },
    escalated: false,
    reasons: [],
  };
}

test("logDecision writes one complete JSONL record without delaying the caller", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choicemymodel-log-"));
  const filePath = join(dir, "decisions.jsonl");

  logDecision(
    { text: "Add CSV export", context: "payments" },
    "codex",
    fakeDecision(),
    { filePath, id: () => "decision-123", now: () => new Date("2026-09-20T12:00:00.000Z") },
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  const [line] = (await readFile(filePath, "utf8")).trim().split("\n");
  assert.deepEqual(JSON.parse(line), {
    id: "decision-123",
    timestamp: "2026-09-20T12:00:00.000Z",
    request: { text: "Add CSV export", context: "payments", kind: "codex" },
    classification: fakeDecision().classification,
    decision: {
      tier: "mid",
      worker: { kind: "claude", model: "claude-sonnet-5", args: "--model claude-sonnet-5" },
      escalated: false,
      reasons: [],
    },
  });
});

test("logDecision includes effortReason and vendorFallbackReason when set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "choicemymodel-log-"));
  const filePath = join(dir, "decisions.jsonl");
  const decision: RoutingDecision = {
    ...fakeDecision(),
    effortReason: "low confidence on reasoning demand, effort raised one step",
    vendorFallbackReason: "codex config unavailable, fell back to claude",
  };

  logDecision({ text: "Add CSV export" }, "claude", decision, {
    filePath,
    id: () => "decision-456",
    now: () => new Date("2026-09-20T12:00:00.000Z"),
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  const [line] = (await readFile(filePath, "utf8")).trim().split("\n");
  const parsed = JSON.parse(line);
  assert.equal(parsed.decision.effortReason, "low confidence on reasoning demand, effort raised one step");
  assert.equal(parsed.decision.vendorFallbackReason, "codex config unavailable, fell back to claude");
});

test("logDecision swallows an asynchronous write failure", async () => {
  const errors: string[] = [];

  assert.doesNotThrow(() => {
    logDecision(
      { text: "Add CSV export" },
      undefined,
      fakeDecision(),
      {
        append: async () => Promise.reject(new Error("disk full")),
        error: (message) => errors.push(message),
      },
    );
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ["Could not write routing decision: disk full"]);
});

test("default observability paths are anchored to the package root when cwd changes", async () => {
  const originalCwd = process.cwd();
  const foreignCwd = await mkdtemp(join(tmpdir(), "choicemymodel-foreign-cwd-"));
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  let loggedPath: string | undefined;
  let readPath: string | undefined;
  let evalCasesPath: string | undefined;

  try {
    process.chdir(foreignCwd);
    logDecision(
      { text: "Anchor this decision" },
      undefined,
      fakeDecision(),
      { append: async (filePath) => { loggedPath = filePath; } },
    );
    await new Promise((resolve) => setImmediate(resolve));

    const result = await promoteDecision(
      "decision-123",
      { expectedUseCase: "implement" },
      {
        read: async (filePath) => {
          readPath = filePath;
          return JSON.stringify({ id: "decision-123", request: { text: "Anchor this decision" } });
        },
        readEvalCases: async (filePath) => {
          evalCasesPath = filePath;
          return "export const EVAL_CASES = [\n];\n";
        },
        writeEvalCases: async () => {},
      },
    );

    assert.deepEqual(result, { status: "promoted" });
    assert.equal(loggedPath, resolve(packageRoot, "data/decisions.jsonl"));
    assert.equal(readPath, resolve(packageRoot, "data/decisions.jsonl"));
    assert.equal(evalCasesPath, resolve(packageRoot, "src/evals/cases.ts"));
  } finally {
    process.chdir(originalCwd);
  }
});

test("chooseModel records every completed routing decision", async () => {
  let logged = false;
  const decision = await chooseModel(
    { text: "Add CSV export" },
    { kind: "claude" },
    {
      classify: async () => fakeDecision().classification,
      log: () => {
        logged = true;
      },
    },
  );

  assert.equal(decision.tier, "mid");
  assert.equal(decision.worker.kind, "claude");
  assert.equal(logged, true);
});

test("chooseModel resolves the real codex model id before returning", async () => {
  const decision = await chooseModel(
    { text: "Bump every dependency" },
    { kind: "codex" },
    {
      classify: async () => fakeDecision().classification,
      log: () => {},
      resolveCodexModel: async (tier) => `gpt-9.9-${tier === "mid" ? "terra" : "other"}`,
    },
  );

  assert.equal(decision.worker.kind, "codex");
  assert.equal(decision.worker.model, "gpt-9.9-terra");
  assert.match(decision.worker.args, /^-m gpt-9\.9-terra /);
});

test("chooseModel falls back to claude when codex resolution fails for an auto-picked vendor", async () => {
  let logged: RoutingDecision | undefined;
  const decision = await chooseModel(
    { text: "Rename fetchUser across the repo" },
    {}, // no explicit kind: "chore" defaults to codex in DEFAULT_VENDOR_TABLE
    {
      classify: async () => ({ ...fakeDecision().classification, useCase: "chore", solutionShape: 0.5 }),
      log: (_state, _kind, d) => {
        logged = d;
      },
      resolveCodexModel: async () => {
        throw new Error("ENOENT: no such file or directory");
      },
    },
  );

  assert.equal(decision.worker.kind, "claude");
  assert.equal(decision.vendorFallbackReason, "codex config unavailable, fell back to claude");
  assert.equal(decision.effortReason, undefined);
  assert.equal(logged?.worker.kind, "claude");
  assert.equal(logged?.vendorFallbackReason, "codex config unavailable, fell back to claude");
});

test("chooseModel still throws when codex is requested explicitly and resolution fails, after logging the attempt", async () => {
  let logged: RoutingDecision | undefined;

  await assert.rejects(
    chooseModel(
      { text: "Bump every dependency" },
      { kind: "codex" },
      {
        classify: async () => fakeDecision().classification,
        log: (_state, _kind, d) => {
          logged = d;
        },
        resolveCodexModel: async () => {
          throw new Error("ENOENT: config missing");
        },
      },
    ),
    /ENOENT: config missing/,
  );

  assert.equal(logged?.worker.kind, "codex");
  assert.equal(logged?.vendorFallbackReason, "codex config unavailable, model resolution failed");
});
