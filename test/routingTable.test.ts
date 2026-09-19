import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROUTING_TABLE, MODEL_IDS, route } from "../src/routingTable.js";
import type { Classification } from "../src/types.js";

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    useCase: "lookup",
    spansMultipleSystems: false,
    hardToReverse: false,
    craftIsMainDifficulty: false,
    confidence: 0.9,
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
  const decision = route(classification({ useCase: "automation", hardToReverse: true }));
  assert.equal(decision.tier, "opus");
  assert.equal(decision.escalated, true);
  assert.deepEqual(decision.reasons, ["hard to reverse if wrong"]);
});

test("escalates one tier when craft is the main difficulty", () => {
  const decision = route(classification({ useCase: "communication", craftIsMainDifficulty: true }));
  assert.equal(decision.tier, "sonnet");
  assert.equal(decision.escalated, true);
});

test("never escalates past opus even with multiple reasons", () => {
  const decision = route(
    classification({ useCase: "deliverable", craftIsMainDifficulty: true, hardToReverse: true }),
  );
  assert.equal(decision.tier, "opus");
  assert.equal(decision.reasons.length, 2);
});

test("falls back to sonnet for an unmapped table entry", () => {
  const decision = route(classification({ useCase: "other" }), {} as typeof DEFAULT_ROUTING_TABLE);
  assert.equal(decision.tier, "sonnet");
});
