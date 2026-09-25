import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THRESHOLDS, ROSTERS, route, selectReasoningEffort } from "../src/routingTable.js";
import type { Classification } from "../src/types.js";

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    useCase: "lookup",
    useCaseConfidence: 0.9,
    spansMultipleSystems: 0,
    hardToReverse: 0,
    solutionShape: 0.5,
    executionScope: "read_only",
    reasoningDemand: "bounded",
    reasoningDemandConfidence: 0.9,
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
  const decision = route(
    classification({
      useCase: "implement",
      executionScope: "local_write",
      reasoningDemand: "iterative",
      reasoningDemandConfidence: 0.9,
    }),
    { kind: "codex" },
  );
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

test("selectReasoningEffort maps each reasoning demand to its base effort", () => {
  const cases: Array<[Classification["reasoningDemand"], string]> = [
    ["direct", "low"],
    ["bounded", "medium"],
    ["iterative", "high"],
    ["deep", "xhigh"],
  ];
  for (const [reasoningDemand, expected] of cases) {
    const selection = selectReasoningEffort(
      classification({ reasoningDemand, reasoningDemandConfidence: 0.9 }),
      DEFAULT_THRESHOLDS,
    );
    assert.equal(selection.effort, expected, `${reasoningDemand} -> ${expected}`);
    assert.equal(selection.reason, undefined);
  }
});

test("selectReasoningEffort bumps effort up one step when reasoning demand confidence is low", () => {
  const selection = selectReasoningEffort(
    classification({ reasoningDemand: "bounded", reasoningDemandConfidence: 0.4 }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(selection.effort, "high");
  assert.match(selection.reason ?? "", /low confidence on reasoning demand/);
});

test("selectReasoningEffort caps the confidence bump at xhigh", () => {
  const selection = selectReasoningEffort(
    classification({ reasoningDemand: "deep", reasoningDemandConfidence: 0.1 }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(selection.effort, "xhigh");
});

test("selectReasoningEffort floors effort at medium when the use case itself is uncertain", () => {
  const selection = selectReasoningEffort(
    classification({
      useCase: "implement",
      useCaseConfidence: 0.5, // below implement's 0.75 floor
      reasoningDemand: "direct",
      reasoningDemandConfidence: 0.95,
    }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(selection.effort, "medium");
  assert.match(selection.reason ?? "", /classifier unsure which task class this is/);
});

test("selectReasoningEffort never returns none or max", () => {
  for (const reasoningDemand of ["direct", "bounded", "iterative", "deep"] as const) {
    const selection = selectReasoningEffort(
      classification({ reasoningDemand, reasoningDemandConfidence: 0.1, useCaseConfidence: 0.1 }),
      DEFAULT_THRESHOLDS,
    );
    assert.notEqual(selection.effort, "none");
    assert.notEqual(selection.effort, "max");
  }
});

test("route() never sets an effort for a claude worker", () => {
  const decision = route(classification(), { kind: "claude" });
  assert.equal(decision.worker.effort, undefined);
  assert.equal(decision.effortReason, undefined);
});

test("route() throws when an explicit effort is given for a claude worker", () => {
  assert.throws(
    () => route(classification(), { kind: "claude", effort: "high" }),
    /RouteOptions\.effort only applies to codex/,
  );
});

test("route() throws when the vendor auto-pick resolves to claude with an explicit effort", () => {
  // useCase "implement" defaults to claude in DEFAULT_VENDOR_TABLE, with no kind override.
  assert.throws(
    () => route(classification({ useCase: "implement" }), { effort: "high" }),
    /RouteOptions\.effort only applies to codex/,
  );
});

test("route() lets an explicit effort override the automatic codex selection", () => {
  const decision = route(classification({ reasoningDemand: "direct", reasoningDemandConfidence: 0.9 }), {
    kind: "codex",
    effort: "max",
  });
  assert.equal(decision.worker.effort, "max");
  assert.equal(decision.effortReason, undefined);
});

test("route() picks the same codex effort for the same reasoning demand regardless of tier", () => {
  const light = route(
    classification({ useCase: "lookup", reasoningDemand: "iterative", reasoningDemandConfidence: 0.9 }),
    { kind: "codex" },
  );
  const mid = route(
    classification({ useCase: "debug", reasoningDemand: "iterative", reasoningDemandConfidence: 0.9 }),
    { kind: "codex" },
  );
  assert.equal(light.tier, "light");
  assert.equal(mid.tier, "mid");
  assert.equal(light.worker.effort, "high");
  assert.equal(mid.worker.effort, "high");
});

// A low solutionShape only means something on classes where "design judgment"
// is a real axis (implement/refactor). On other classes the noul still comes
// back near 0 or 1 (it's a probability, it has to answer something), but
// reading it there was wrongly escalating lookups/debugs/reviews.
test("a low solutionShape does not escalate lookup, debug or review", () => {
  for (const useCase of ["lookup", "debug", "review"] as const) {
    const decision = route(classification({ useCase, solutionShape: 0.1 }));
    assert.ok(
      !decision.reasons.includes("design judgment is the main difficulty"),
      `${useCase} should not escalate on solutionShape`,
    );
  }
});

test("a low solutionShape still escalates implement and refactor", () => {
  for (const useCase of ["implement", "refactor"] as const) {
    const decision = route(classification({ useCase, solutionShape: 0.1 }));
    assert.ok(
      decision.reasons.includes("design judgment is the main difficulty"),
      `${useCase} should escalate on solutionShape`,
    );
    assert.equal(decision.escalated, true);
  }
});

test("other risk signals still escalate lookup/debug/review even though solutionShape is ignored there", () => {
  const decision = route(classification({ useCase: "debug", solutionShape: 0.1, spansMultipleSystems: 0.9 }));
  assert.deepEqual(decision.reasons, ["spans 4+ systems"]);
  assert.equal(decision.escalated, true);
});

test("selectReasoningEffort floors effort at medium when a critical risk forces the frontier tier", () => {
  const hardToReverse = selectReasoningEffort(
    classification({ reasoningDemand: "direct", reasoningDemandConfidence: 0.95, hardToReverse: 0.9 }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(hardToReverse.effort, "medium");
  assert.match(hardToReverse.reason ?? "", /critical risk/);

  const externalEffect = selectReasoningEffort(
    classification({
      reasoningDemand: "direct",
      reasoningDemandConfidence: 0.95,
      executionScope: "external_effect",
    }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(externalEffect.effort, "medium");
  assert.match(externalEffect.reason ?? "", /critical risk/);
});

test("route() never pairs a frontier tier forced by critical risk with a low effort", () => {
  const decision = route(
    classification({
      useCase: "implement",
      hardToReverse: 0.9,
      reasoningDemand: "direct",
      reasoningDemandConfidence: 0.95,
    }),
    { kind: "codex" },
  );
  assert.equal(decision.tier, "frontier");
  assert.equal(decision.worker.effort, "medium");
});

test("selectReasoningEffort defaults to medium when reasoningDemand is unrecognized", () => {
  const selection = selectReasoningEffort(
    classification({ reasoningDemand: "urgent" as Classification["reasoningDemand"], reasoningDemandConfidence: 0.95 }),
    DEFAULT_THRESHOLDS,
  );
  assert.equal(selection.effort, "medium");
  assert.match(selection.reason ?? "", /unrecognized reasoning demand/);
});

test("selectReasoningEffort never lets an unrecognized reasoningDemand reach the rendered args as undefined", () => {
  const decision = route(
    classification({ reasoningDemand: undefined as unknown as Classification["reasoningDemand"] }),
    { kind: "codex" },
  );
  assert.equal(decision.worker.effort, "medium");
  assert.doesNotMatch(decision.worker.args, /undefined/);
});

test("selectReasoningEffort still applies its confidence guard rail with a partial custom thresholds object", () => {
  // A caller-supplied thresholds object that omits reasoningDemandConfidence
  // must not silently disable the guard rail (`x < undefined` is always false).
  const partialThresholds = { noul: 0.7, minUseCaseConfidence: 0.5 } as unknown as typeof DEFAULT_THRESHOLDS;
  const selection = selectReasoningEffort(
    classification({ reasoningDemand: "bounded", reasoningDemandConfidence: 0.4 }),
    partialThresholds,
  );
  assert.equal(selection.effort, "high");
  assert.match(selection.reason ?? "", /low confidence on reasoning demand/);
});
