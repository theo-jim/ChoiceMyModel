import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THRESHOLDS, ROSTERS, route } from "../src/routingTable.js";
import type { Classification } from "../src/types.js";

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    useCase: "lookup",
    useCaseConfidence: 0.9,
    spansMultipleSystems: 0,
    hardToReverse: 0,
    craftIsMainDifficulty: 0,
    isBulkMechanical: 0,
    needsWriteAccess: 0,
    backend: "jev",
    latencyMs: 100,
    ...overrides,
  };
}

test("routes a plain lookup to the light tier", () => {
  const decision = route(classification({ useCase: "lookup" }));
  assert.equal(decision.tier, "light");
  assert.equal(decision.worker.model, ROSTERS.claude.light.model);
  assert.equal(decision.escalated, false);
  assert.deepEqual(decision.reasons, []);
});

test("escalates one tier when the task is hard to reverse", () => {
  const decision = route(classification({ useCase: "implement", hardToReverse: 0.92 }));
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.escalated, true);
  assert.deepEqual(decision.reasons, ["hard to reverse if wrong"]);
});

test("a noul below the threshold does not escalate", () => {
  const decision = route(classification({ useCase: "implement", hardToReverse: 0.55 }));
  assert.equal(decision.tier, "mid");
  assert.equal(decision.escalated, false);
});

test("renders claude args with the permission flag re-included", () => {
  const decision = route(classification({ useCase: "implement" }), { kind: "claude" });
  assert.equal(decision.worker.kind, "claude");
  assert.equal(decision.worker.args, "--model claude-sonnet-5 --permission-mode acceptEdits");
  assert.equal(decision.worker.effort, undefined);
});

test("renders codex args with model, reasoning effort and a write sandbox", () => {
  const decision = route(classification({ useCase: "implement", needsWriteAccess: 0.95 }), {
    kind: "codex",
  });
  assert.equal(decision.worker.kind, "codex");
  assert.equal(decision.worker.effort, "high");
  assert.equal(
    decision.worker.args,
    "-m gpt-5.6-terra -c model_reasoning_effort=high --sandbox workspace-write",
  );
});

test("a codex worker that writes nothing gets a read-only sandbox", () => {
  const decision = route(classification({ useCase: "review", needsWriteAccess: 0.05 }), {
    kind: "codex",
  });
  assert.match(decision.worker.args, /--sandbox read-only/);
});

test("bulk mechanical work drops a tier", () => {
  const decision = route(classification({ useCase: "refactor", isBulkMechanical: 0.9 }));
  assert.equal(decision.tier, "light");
  assert.equal(decision.escalated, false);
  assert.deepEqual(decision.reasons, ["bulk mechanical work, dropped a tier"]);
});

test("a class already on the light tier reports no drop", () => {
  const decision = route(classification({ useCase: "chore", isBulkMechanical: 0.9 }));
  assert.equal(decision.tier, "light");
  assert.deepEqual(decision.reasons, []);
});

test("bulk mechanical never suppresses a risk signal", () => {
  const decision = route(
    classification({ useCase: "refactor", isBulkMechanical: 0.95, hardToReverse: 0.9 }),
  );
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.escalated, true);
  assert.deepEqual(decision.reasons, ["hard to reverse if wrong"]);
});

test("applies a stricter confidence floor to implement than to lookup", () => {
  const implement = route(classification({ useCase: "implement", useCaseConfidence: 0.65 }));
  assert.deepEqual(implement.reasons, ["classifier unsure which task class this is"]);
  assert.equal(implement.tier, "frontier");

  const lookup = route(classification({ useCase: "lookup", useCaseConfidence: 0.65 }));
  assert.deepEqual(lookup.reasons, []);
  assert.equal(lookup.tier, "light");
});

test("a class with no per-class floor falls back to the global one", () => {
  assert.equal(DEFAULT_THRESHOLDS.useCaseConfidenceFloors?.docs, undefined);
  assert.deepEqual(route(classification({ useCase: "docs", useCaseConfidence: 0.55 })).reasons, []);
  assert.deepEqual(route(classification({ useCase: "docs", useCaseConfidence: 0.45 })).reasons, [
    "classifier unsure which task class this is",
  ]);
});

test("never escalates past the frontier tier", () => {
  const decision = route(
    classification({
      useCase: "implement",
      hardToReverse: 0.9,
      spansMultipleSystems: 0.9,
      craftIsMainDifficulty: 0.9,
    }),
  );
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.reasons.length, 3);
});
