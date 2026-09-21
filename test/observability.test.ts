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
      craftIsMainDifficulty: 0.3,
      isBulkMechanical: 0,
      needsWriteAccess: 0.9,
      vendorFit: 0.1,
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
