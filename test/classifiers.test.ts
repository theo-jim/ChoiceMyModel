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
          craft_is_main_difficulty: { type: "noul", noul: 0.3 },
          is_bulk_mechanical: { type: "noul", noul: 0.05 },
          needs_write_access: { type: "noul", noul: 0.9 },
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
  assert.equal(result.needsWriteAccess, 0.9);
  assert.ok(result.latencyMs >= 0);

  // The request actually carried the task state and the routing questions.
  assert.match(sentUrl, /\/v1\/systemone$/);
  const body = sentBody as { state: { task: string; context?: string }; questions: object };
  assert.equal(body.state.task, "The webhook returns 500 intermittently, find out why");
  assert.equal(body.state.context, "repo: payments");
  assert.ok("use_case" in body.questions);
  assert.ok("needs_write_access" in body.questions);
});
