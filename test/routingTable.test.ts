import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROUTING_TABLE, DEFAULT_THRESHOLDS, MODEL_IDS, route } from "../src/routingTable.js";
import type { Classification } from "../src/types.js";

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    useCase: "lookup",
    useCaseConfidence: 0.9,
    spansMultipleSystems: 0,
    hardToReverse: 0,
    craftIsMainDifficulty: 0,
    isBulkOperation: 0,
    isClientFacing: 0,
    backend: "jev",
    latencyMs: 100,
    ...overrides,
  };
}

test("routes a plain lookup to haiku", () => {
  const decision = route(classification({ useCase: "lookup" }));
  assert.equal(decision.tier, "haiku");
  assert.equal(decision.model, MODEL_IDS.haiku);
  assert.equal(decision.escalated, false);
  assert.deepEqual(decision.reasons, []);
});

test("escalates one tier when the action is hard to reverse", () => {
  const decision = route(classification({ useCase: "automation", hardToReverse: 0.92 }));
  assert.equal(decision.tier, "opus");
  assert.equal(decision.escalated, true);
  assert.deepEqual(decision.reasons, ["hard to reverse if wrong"]);
});

test("a noul below the threshold does not escalate", () => {
  const decision = route(classification({ useCase: "automation", hardToReverse: 0.55 }));
  assert.equal(decision.tier, "sonnet");
  assert.equal(decision.escalated, false);
});

test("escalates one tier when craft is the main difficulty", () => {
  const decision = route(classification({ useCase: "communication", craftIsMainDifficulty: 0.81 }));
  assert.equal(decision.tier, "sonnet");
  assert.equal(decision.escalated, true);
});

test("escalates when the classifier is not confident in the use case", () => {
  const decision = route(classification({ useCase: "lookup", useCaseConfidence: 0.31 }));
  assert.equal(decision.tier, "sonnet");
  assert.deepEqual(decision.reasons, ["classifier unsure which use case this is"]);
});

test("never escalates past opus even with several reasons", () => {
  const decision = route(
    classification({
      useCase: "deliverable",
      craftIsMainDifficulty: 0.9,
      hardToReverse: 0.9,
      spansMultipleSystems: 0.9,
    }),
  );
  assert.equal(decision.tier, "opus");
  assert.equal(decision.reasons.length, 3);
});

test("reads isBulkOperation only on the automation branch", () => {
  const onBranch = route(classification({ useCase: "automation", isBulkOperation: 0.95 }));
  assert.deepEqual(onBranch.reasons, ["acts on many records at once"]);

  // Same speculative answer, irrelevant branch: ignored rather than escalating.
  const offBranch = route(classification({ useCase: "lookup", isBulkOperation: 0.95 }));
  assert.deepEqual(offBranch.reasons, []);
  assert.equal(offBranch.tier, "haiku");
});

test("reads isClientFacing only on the communication and deliverable branches", () => {
  const communication = route(classification({ useCase: "communication", isClientFacing: 0.9 }));
  assert.deepEqual(communication.reasons, ["client-facing output"]);
  assert.equal(communication.tier, "sonnet");

  const deliverable = route(classification({ useCase: "deliverable", isClientFacing: 0.9 }));
  assert.equal(deliverable.tier, "opus");

  const summarization = route(classification({ useCase: "summarization", isClientFacing: 0.9 }));
  assert.deepEqual(summarization.reasons, []);
  assert.equal(summarization.tier, "haiku");
});

test("applies a stricter confidence floor to automation than to lookup", () => {
  // 0.7 clears the global 0.5 floor but not automation's own 0.75.
  const automation = route(classification({ useCase: "automation", useCaseConfidence: 0.7 }));
  assert.deepEqual(automation.reasons, ["classifier unsure which use case this is"]);
  assert.equal(automation.tier, "opus");

  const lookup = route(classification({ useCase: "lookup", useCaseConfidence: 0.7 }));
  assert.deepEqual(lookup.reasons, []);
  assert.equal(lookup.tier, "haiku");
});

test("a class with no per-class floor falls back to the global one", () => {
  assert.equal(DEFAULT_THRESHOLDS.useCaseConfidenceFloors?.summarization, undefined);

  const justAbove = route(classification({ useCase: "summarization", useCaseConfidence: 0.55 }));
  assert.deepEqual(justAbove.reasons, []);

  const justBelow = route(classification({ useCase: "summarization", useCaseConfidence: 0.45 }));
  assert.deepEqual(justBelow.reasons, ["classifier unsure which use case this is"]);
});

test("falls back to sonnet for an unmapped table entry", () => {
  const decision = route(classification({ useCase: "other" }), {} as typeof DEFAULT_ROUTING_TABLE);
  assert.equal(decision.tier, "sonnet");
});

test("respects custom thresholds", () => {
  const decision = route(classification({ useCase: "lookup", hardToReverse: 0.4 }), DEFAULT_ROUTING_TABLE, {
    noul: 0.3,
    minUseCaseConfidence: 0.5,
  });
  assert.equal(decision.tier, "sonnet");
  assert.equal(decision.escalated, true);
});
