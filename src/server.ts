import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chooseModel } from "./chooseModel.js";
import type { AgentKind, RoutingDecision, TaskState } from "./types.js";

const PORT = Number(process.env.PORT ?? 8787);

/**
 * Cap on the request body. This is an internal single-user tool, but an
 * unbounded read lets one client accumulate arbitrary memory, so we stop
 * reading — and reject — as soon as the body crosses the limit.
 */
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

/** Reading past the body limit rejects with this so the handler can answer 413. */
class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Collect raw bytes and decode once at the end. Decoding per chunk would
    // corrupt a multi-byte UTF-8 character (e.g. €) that a network split lands
    // across two chunks; Buffer.concat keeps the bytes intact until then.
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer | string) => {
      if (overflowed) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        // Stop buffering and reject, but let the request drain so the handler's
        // response can flush cleanly instead of the socket being torn down.
        overflowed = true;
        req.resume();
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

type ChooseFn = (
  state: TaskState,
  options: { kind?: AgentKind },
) => Promise<RoutingDecision>;

export interface ChoiceServerOptions {
  /** Injectable for tests; defaults to the real classify+route pipeline. */
  choose?: ChooseFn;
  maxBodyBytes?: number;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function createChoiceServer(options: ChoiceServerOptions = {}): Server {
  const choose = options.choose ?? chooseModel;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/choose") {
      // Read + parse the request. Every failure here is the client's fault, so
      // it gets a 4xx and a message safe to show (it describes their input,
      // never our internals).
      let body: unknown;
      try {
        const raw = await readBody(req, maxBodyBytes);
        body = JSON.parse(raw);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          sendJson(res, 413, { error: "request body too large" });
        } else {
          sendJson(res, 400, { error: "invalid JSON request body" });
        }
        return;
      }

      // Validate every field before we call anything, so a bad "kind" or a
      // non-string "context" is a 400 (client error), not a 502 (which would
      // wrongly blame the classifier for the client's malformed input).
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      const { text, context, kind } = body as Record<string, unknown>;
      if (typeof text !== "string" || text.length === 0) {
        sendJson(res, 400, { error: '"text" is required' });
        return;
      }
      if (context !== undefined && typeof context !== "string") {
        sendJson(res, 400, { error: '"context" must be a string' });
        return;
      }
      if (kind !== undefined && kind !== "claude" && kind !== "codex") {
        sendJson(res, 400, { error: '"kind" must be "claude" or "codex"' });
        return;
      }

      // From here it is the classifier/route pipeline. A failure is an upstream
      // problem, not the client's: answer 502 with a generic message and keep
      // the real error (which can carry SDK/key detail) in the server log only.
      try {
        const decision = await choose(
          { text, context: context as string | undefined },
          { kind: kind as AgentKind | undefined },
        );
        sendJson(res, 200, decision);
      } catch (err) {
        console.error("POST /choose failed:", err);
        sendJson(res, 502, { error: "failed to classify task" });
      }
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });
}

// Start listening only when run as the entry point, so tests can import
// createChoiceServer without binding a port.
if (import.meta.url === `file://${process.argv[1]}`) {
  createChoiceServer().listen(PORT, () => {
    console.log(`ChoiceMyModel listening on :${PORT}`);
  });
}
