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
    solutionShape: 0.5,
    executionScope: "read_only",
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

test("escalates straight to frontier when the task is hard to reverse", () => {
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

test("an external_effect scope forces the frontier tier", () => {
  const decision = route(classification({ useCase: "implement", executionScope: "external_effect" }));
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.escalated, true);
  assert.deepEqual(decision.reasons, ["has an effect outside the working copy"]);
});

test("a local_write scope alone does not escalate the tier", () => {
  const decision = route(classification({ useCase: "implement", executionScope: "local_write" }));
  assert.equal(decision.tier, "mid");
  assert.deepEqual(decision.reasons, []);
});

test("renders claude args with the permission flag re-included", () => {
  const decision = route(classification({ useCase: "implement", executionScope: "local_write" }), {
    kind: "claude",
  });
  assert.equal(decision.worker.kind, "claude");
  assert.equal(decision.worker.args, "--model sonnet --permission-mode acceptEdits");
  assert.equal(decision.worker.effort, undefined);
});

test("a claude worker with a read-only scope gets plan (read-only) mode", () => {
  const decision = route(classification({ useCase: "review", executionScope: "read_only" }), {
    kind: "claude",
  });
  assert.equal(decision.worker.args, "--model sonnet --permission-mode plan");
});

test("renders codex args with the roster's tier suffix, reasoning effort and a write sandbox", () => {
  const decision = route(classification({ useCase: "implement", executionScope: "local_write" }), {
    kind: "codex",
  });
  assert.equal(decision.worker.kind, "codex");
  assert.equal(decision.worker.effort, "high");
  assert.equal(decision.worker.args, "-m terra -c model_reasoning_effort=high --sandbox workspace-write");
});

test("a codex worker with a read-only scope gets a read-only sandbox", () => {
  const decision = route(classification({ useCase: "review", executionScope: "read_only" }), {
    kind: "codex",
  });
  assert.match(decision.worker.args, /--sandbox read-only/);
});

test("with no explicit kind, a class that defaults to claude switches to codex when bulk mechanical", () => {
  const decision = route(classification({ useCase: "implement", solutionShape: 0.9 }));
  assert.equal(decision.worker.kind, "codex");
});

test("with no explicit kind, a class that defaults to claude stays on claude otherwise", () => {
  const decision = route(classification({ useCase: "implement", solutionShape: 0.5 }));
  assert.equal(decision.worker.kind, "claude");
});

test("with no explicit kind, a class that defaults to codex switches to claude when craft-dominant", () => {
  const decision = route(classification({ useCase: "chore", solutionShape: 0.1 }));
  assert.equal(decision.worker.kind, "claude");
});

test("with no explicit kind, a class that defaults to codex stays on codex otherwise", () => {
  const decision = route(classification({ useCase: "chore", solutionShape: 0.5 }));
  assert.equal(decision.worker.kind, "codex");
});

test("solutionShape exactly at the noul threshold switches the default claude class to codex", () => {
  const decision = route(classification({ useCase: "implement", solutionShape: 0.7 }));
  assert.equal(decision.worker.kind, "codex");
});

test("an explicit kind overrides the vendor pick even when solutionShape would have picked the other vendor", () => {
  const decision = route(classification({ useCase: "chore", solutionShape: 0.9 }), { kind: "claude" });
  assert.equal(decision.worker.kind, "claude");
});

test("bulk mechanical work drops a tier", () => {
  const decision = route(classification({ useCase: "refactor", solutionShape: 0.9 }));
  assert.equal(decision.tier, "light");
  assert.equal(decision.escalated, false);
  assert.deepEqual(decision.reasons, ["bulk mechanical work, dropped a tier"]);
});

test("a class already on the light tier reports no drop", () => {
  const decision = route(classification({ useCase: "chore", solutionShape: 0.9 }));
  assert.equal(decision.tier, "light");
  assert.deepEqual(decision.reasons, []);
});

test("bulk mechanical never suppresses a risk signal", () => {
  const decision = route(
    classification({ useCase: "refactor", solutionShape: 0.95, hardToReverse: 0.9 }),
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

test("holds the implement confidence floor exactly at 0.75", () => {
  // The floor check is strict (< floor), so 0.75 itself clears the bar.
  const floor = DEFAULT_THRESHOLDS.useCaseConfidenceFloors?.implement;
  assert.equal(floor, 0.75);

  const below = route(classification({ useCase: "implement", useCaseConfidence: 0.74 }));
  assert.deepEqual(below.reasons, ["classifier unsure which task class this is"]);
  assert.equal(below.tier, "frontier");

  const atFloor = route(classification({ useCase: "implement", useCaseConfidence: 0.75 }));
  assert.deepEqual(atFloor.reasons, []);
  assert.equal(atFloor.tier, "mid");

  const above = route(classification({ useCase: "implement", useCaseConfidence: 0.76 }));
  assert.deepEqual(above.reasons, []);
  assert.equal(above.tier, "mid");
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
      solutionShape: 0.1,
    }),
  );
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.reasons.length, 3);
});
