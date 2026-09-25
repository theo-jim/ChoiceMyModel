import assert from "node:assert/strict";
import { test } from "node:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyWithJev } from "../src/classifiers/jev.js";

/**
 * These exercise the full SDK pipeline (request assembly + response parsing)
 * against a stubbed transport, so no API key or network is needed. The client
 * is real; only its `fetch` is faked.
 */

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("jev classifier maps a systemOne answer set onto a Classification", async () => {
  let sentUrl = "";
  let sentBody: unknown;

  const client = new TypeSafeClient({
    apiKey: "test-key",
    logLevel: "off",
    retry: { maxRetries: 0 },
    fetch: async (input, init) => {
      sentUrl = String(input);
      sentBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({
        answers: {
          use_case: {
            type: "choice",
            choice: "debug",
            confidence: 0.82,
            probabilities: { debug: 0.82, implement: 0.1, other: 0.08 },
          },
          spans_multiple_systems: { type: "noul", noul: 0.1 },
          hard_to_reverse: { type: "noul", noul: 0.2 },
          solution_shape: { type: "noul", noul: 0.3 },
          execution_scope: {
            type: "choice",
            choice: "local_write",
            confidence: 0.88,
            probabilities: { read_only: 0.02, local_write: 0.88, external_effect: 0.1 },
          },
          reasoning_demand: {
            type: "choice",
            choice: "iterative",
            confidence: 0.71,
            probabilities: { direct: 0.02, bounded: 0.12, iterative: 0.71, deep: 0.15 },
          },
        },
        model: "jev-latest",
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    },
  });

  const result = await classifyWithJev(
    { text: "The webhook returns 500 intermittently, find out why", context: "repo: payments" },
    client,
  );

  assert.equal(result.backend, "jev");
  assert.equal(result.useCase, "debug");
  assert.equal(result.useCaseConfidence, 0.82);
  assert.deepEqual(result.useCaseProbabilities, { debug: 0.82, implement: 0.1, other: 0.08 });
  assert.equal(result.hardToReverse, 0.2);
  assert.equal(result.solutionShape, 0.3);
  assert.equal(result.executionScope, "local_write");
  assert.equal(result.reasoningDemand, "iterative");
  assert.equal(result.reasoningDemandConfidence, 0.71);
  assert.deepEqual(result.reasoningDemandProbabilities, {
    direct: 0.02,
    bounded: 0.12,
    iterative: 0.71,
    deep: 0.15,
  });
  assert.ok(result.latencyMs >= 0);

  // The request actually carried the task state and the routing questions.
  assert.match(sentUrl, /\/v1\/systemone$/);
  const body = sentBody as { state: { task: string; context?: string }; questions: object };
  assert.equal(body.state.task, "The webhook returns 500 intermittently, find out why");
  assert.equal(body.state.context, "repo: payments");
  assert.ok("use_case" in body.questions);
  assert.ok("solution_shape" in body.questions);
  assert.ok("execution_scope" in body.questions);
  assert.ok("reasoning_demand" in body.questions);
});
