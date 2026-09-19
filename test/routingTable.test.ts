import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROUTING_TABLE, MODEL_IDS, route } from "../src/routingTable.js";
import type { Classification } from "../src/types.js";

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    useCase: "lookup",
    useCaseConfidence: 0.9,
    spansMultipleSystems: 0,
    hardToReverse: 0,
    craftIsMainDifficulty: 0,
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
