import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createChoiceServer, readBody, type ChoiceServerOptions } from "../src/server.js";
import type { RoutingDecision, TaskState } from "../src/types.js";

function fakeDecision(): RoutingDecision {
  return {
    tier: "mid",
    worker: {
      kind: "claude",
      model: "claude-sonnet-5",
      args: "--model claude-sonnet-5 --permission-mode acceptEdits",
    },
    classification: {
      useCase: "implement",
      useCaseConfidence: 0.9,
      spansMultipleSystems: 0,
      hardToReverse: 0,
      craftIsMainDifficulty: 0,
      isBulkMechanical: 0,
      needsWriteAccess: 0.9,
      vendorFit: 0,
      backend: "jev",
      latencyMs: 1,
    },
    escalated: false,
    reasons: [],
  };
}

async function withServer(
  options: ChoiceServerOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createChoiceServer(options);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /health returns ok", async () => {
  await withServer({ choose: async () => fakeDecision() }, async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("POST /choose returns the routing decision and passes the task through", async () => {
  let seen: { state: TaskState; kind?: string } | undefined;
  await withServer(
    {
      choose: async (state, opts) => {
        seen = { state, kind: opts.kind };
        return fakeDecision();
      },
    },
    async (base) => {
      const res = await fetch(`${base}/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Add a CSV export endpoint", context: "repo: web", kind: "claude" }),
      });
      assert.equal(res.status, 200);
      const decision = (await res.json()) as RoutingDecision;
      assert.equal(decision.tier, "mid");
      assert.equal(seen?.state.text, "Add a CSV export endpoint");
      assert.equal(seen?.state.context, "repo: web");
      assert.equal(seen?.kind, "claude");
    },
  );
});

test("POST /choose returns 400 for malformed JSON (a client error, not 502)", async () => {
  await withServer({ choose: async () => fakeDecision() }, async (base) => {
    const res = await fetch(`${base}/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not valid json",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /invalid JSON/);
  });
});

test("POST /choose returns 400 when text is missing", async () => {
  await withServer({ choose: async () => fakeDecision() }, async (base) => {
    const res = await fetch(`${base}/choose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: "no text here" }),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /"text" is required/);
  });
});

test("POST /choose returns 413 without ever calling the pipeline", async () => {
  let called = false;
  await withServer(
    {
      choose: async () => {
        called = true;
        return fakeDecision();
      },
      maxBodyBytes: 64,
    },
    async (base) => {
      const res = await fetch(`${base}/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(500) }),
      });
      assert.equal(res.status, 413);
      assert.equal(called, false, "choose must not run for an oversized body");
    },
  );
});

test("POST /choose returns 400 for an invalid kind (not 502)", async () => {
  let called = false;
  await withServer(
    {
      choose: async () => {
        called = true;
        return fakeDecision();
      },
    },
    async (base) => {
      const res = await fetch(`${base}/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Do it", kind: "gemini" }),
      });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as { error: string }).error, /"kind" must be/);
      assert.equal(called, false, "choose must not run for an invalid kind");
    },
  );
});

test("POST /choose returns 400 for a non-string context (not 502)", async () => {
  let called = false;
  await withServer(
    {
      choose: async () => {
        called = true;
        return fakeDecision();
      },
    },
    async (base) => {
      const res = await fetch(`${base}/choose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Do it", context: { nested: true } }),
      });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as { error: string }).error, /"context" must be a string/);
      assert.equal(called, false, "choose must not run for an invalid context");
    },
  );
});

test("readBody decodes a multi-byte char split across two chunks", async () => {
  // The euro sign is 3 UTF-8 bytes (E2 82 AC); split it mid-character so a
  // per-chunk decode would corrupt it but Buffer.concat does not.
  const payload = Buffer.from('{"text":"a€b"}', "utf8");
  const euroStart = Buffer.from('{"text":"a', "utf8").length;
  const splitAt = euroStart + 1; // one byte into the euro sign
  const req = Readable.from([
    payload.subarray(0, splitAt),
    payload.subarray(splitAt),
  ]) as unknown as IncomingMessage;

  const raw = await readBody(req, 1_000);
  assert.equal(raw, '{"text":"a€b"}');
  assert.equal((JSON.parse(raw) as { text: string }).text, "a€b");
});

test("POST /choose returns 502 with a generic message when the pipeline fails", async () => {
  const originalError = console.error;
  console.error = () => {}; // silence the expected server-side log
  try {
    await withServer(
      {
        choose: async () => {
          throw new Error("ANTHROPIC_API_KEY is missing — secret upstream detail");
        },
      },
      async (base) => {
        const res = await fetch(`${base}/choose`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "Do something" }),
        });
        assert.equal(res.status, 502);
        const bodyText = await res.text();
        assert.doesNotMatch(bodyText, /secret upstream detail/, "raw error must not leak");
        assert.match((JSON.parse(bodyText) as { error: string }).error, /failed to classify/);
      },
    );
  } finally {
    console.error = originalError;
  }
});

test("unknown routes return 404", async () => {
  await withServer({ choose: async () => fakeDecision() }, async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});
