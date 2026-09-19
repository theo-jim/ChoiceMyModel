import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyWithClaude } from "../src/classifiers/claude.js";
import { classifyWithJev } from "../src/classifiers/jev.js";
import { getClassifier } from "../src/classify.js";

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

test("claude classifier reads the classify_task tool call", async () => {
  let sentUrl = "";
  let sentBody: unknown;
  const client = new Anthropic({
    apiKey: "test-key",
    fetch: async (input, init) => {
      sentUrl = String(input);
      sentBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return jsonResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "classify_task",
            input: {
              useCase: "review",
              useCaseConfidence: 0.7,
              spansMultipleSystems: 0.1,
              hardToReverse: 0.2,
              craftIsMainDifficulty: 0.4,
              isBulkMechanical: 0.05,
              needsWriteAccess: 0.02,
            },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 30 },
      });
    },
  });

  const result = await classifyWithClaude(
    { text: "Review the auth diff", context: "repo: auth" },
    client,
  );

  assert.equal(result.backend, "claude");
  assert.equal(result.useCase, "review");
  assert.equal(result.useCaseConfidence, 0.7);
  assert.equal(result.needsWriteAccess, 0.02);
  assert.ok(result.latencyMs >= 0);

  // The request actually carried the model, the classify_task tool, and the state.
  assert.match(sentUrl, /\/v1\/messages$/);
  const body = sentBody as {
    model: string;
    tools: { name: string }[];
    tool_choice: { type: string; name: string };
    messages: { role: string; content: string }[];
  };
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.tools[0]?.name, "classify_task");
  assert.deepEqual(body.tool_choice, { type: "tool", name: "classify_task" });
  assert.match(body.messages[0]?.content ?? "", /Review the auth diff/);
  assert.match(body.messages[0]?.content ?? "", /repo: auth/);
});

test("claude classifier throws when no tool call comes back", async () => {
  const client = new Anthropic({
    apiKey: "test-key",
    fetch: async () =>
      jsonResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: "I cannot classify this." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
  });

  await assert.rejects(
    classifyWithClaude({ text: "Review the auth diff" }, client),
    /did not return a tool call/,
  );
});

test("getClassifier resolves backends and rejects unknown ones", () => {
  const previous = process.env.CLASSIFIER;
  try {
    delete process.env.CLASSIFIER;
    assert.equal(getClassifier(), classifyWithJev, "default is jev");
    assert.equal(getClassifier("claude"), classifyWithClaude, "explicit wins");

    process.env.CLASSIFIER = "claude";
    assert.equal(getClassifier(), classifyWithClaude, "env selects the backend");

    process.env.CLASSIFIER = "nope";
    assert.throws(() => getClassifier(), /unknown classifier backend/);
  } finally {
    if (previous === undefined) delete process.env.CLASSIFIER;
    else process.env.CLASSIFIER = previous;
  }
});
