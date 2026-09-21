import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chooseModel } from "./chooseModel.js";
import { createDecisionStore, type DecisionStore } from "./observability/promote.js";
import { USE_CASES, type AgentKind, type RoutingDecision, type TaskState, type UseCase } from "./types.js";

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
  decisions?: DecisionStore;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChoiceMyModel decisions</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#18212f}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7dce2;padding:8px;vertical-align:top;text-align:left}th{position:sticky;top:0;background:#f7f8fa}details{max-width:340px}pre{white-space:pre-wrap;max-width:500px}select,button{font:inherit;margin-top:4px}.muted{color:#64748b}.error{color:#b42318}</style>
<h1>ChoiceMyModel decisions</h1><p class="muted">Human labels become eval cases; they do not reuse Jev’s prediction.</p>
<p><label>Show <select id="limit"><option>25</option><option selected>50</option><option>100</option><option>200</option></select> latest decisions</label></p>
<div id="status" class="muted">Loading…</div><table><thead><tr><th>Task</th><th>Jev</th><th>Noul signals</th><th>Route</th><th>Latency / time</th><th>Human ground truth</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const uses=${JSON.stringify(USE_CASES)};
const esc=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const signals=["hardToReverse","spansMultipleSystems","craftIsMainDifficulty","isBulkMechanical","needsWriteAccess","vendorFit"];
const options=(selected="")=>uses.map(use=>'<option'+(use===selected?' selected':'')+'>'+use+'</option>').join('');
async function promote(id, form){const body={expectedUseCase:form.querySelector('.use').value};const kind=form.querySelector('.kind').value;if(kind)body.expectedKind=kind;const res=await fetch('/decisions/'+encodeURIComponent(id)+'/promote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();form.querySelector('.result').textContent=data.message||(data.promoted?'Added to evals.':data.error);}
function render(decisions){const rows=document.querySelector('#rows');rows.innerHTML=decisions.map(entry=>{const c=entry.classification,d=entry.decision,text=entry.request.text,short=text.length>120?text.slice(0,120)+'…':text;const probabilities=Object.entries(c.useCaseProbabilities||{}).map(([name,value])=>esc(name)+': '+Number(value).toFixed(2)).join('<br>');const signalText=signals.map(name=>esc(name)+': '+Number(c[name]).toFixed(2)).join('<br>');return '<tr><td><details><summary title="'+esc(text)+'">'+esc(short)+'</summary><pre>'+esc(text)+'</pre></details></td><td><strong>'+esc(c.useCase)+'</strong> ('+Number(c.useCaseConfidence).toFixed(2)+')<br>'+probabilities+'</td><td>'+signalText+'</td><td>'+esc(d.tier)+' / '+esc(d.worker.model)+'<br>escalated: '+esc(d.escalated)+'<br>'+esc((d.reasons||[]).join('; ')||'—')+'</td><td>'+esc(c.latencyMs)+' ms<br>'+esc(entry.timestamp)+'</td><td><form><select class="use">'+options()+'</select><select class="kind"><option value="">kind (optional)</option><option>claude</option><option>codex</option></select><br><button type="submit">Add eval case</button> <span class="result muted"></span></form></td></tr>';}).join('');for(const [index,form] of [...rows.querySelectorAll('form')].entries()){form.addEventListener('submit',event=>{event.preventDefault();promote(decisions[index].id,form).catch(error=>form.querySelector('.result').textContent=error.message);});}}
async function load(){const limit=document.querySelector('#limit').value;const res=await fetch('/decisions?limit='+limit);if(!res.ok)throw new Error('Could not load decisions');const decisions=await res.json();render(decisions);document.querySelector('#status').textContent=decisions.length+' decisions';}
document.querySelector('#limit').addEventListener('change',()=>load().catch(error=>document.querySelector('#status').textContent=error.message));load().catch(error=>{document.querySelector('#status').className='error';document.querySelector('#status').textContent=error.message;});
</script></html>`;
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return undefined;
  return limit;
}

export function createChoiceServer(options: ChoiceServerOptions = {}): Server {
  const choose = options.choose ?? chooseModel;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const decisions = options.decisions ?? createDecisionStore();

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/decisions") {
      const limit = parseLimit(url.searchParams.get("limit"));
      if (limit === undefined) {
        sendJson(res, 400, { error: '"limit" must be an integer from 1 to 200' });
        return;
      }
      try {
        sendJson(res, 200, await decisions.list(limit));
      } catch (err) {
        console.error("GET /decisions failed:", err);
        sendJson(res, 500, { error: "failed to read decisions" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/dashboard") {
      sendHtml(res, dashboardHtml());
      return;
    }

    const promoteMatch = req.method === "POST" && url.pathname.match(/^\/decisions\/([^/]+)\/promote$/);
    if (promoteMatch) {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, maxBodyBytes));
      } catch (err) {
        sendJson(res, err instanceof PayloadTooLargeError ? 413 : 400, {
          error: err instanceof PayloadTooLargeError ? "request body too large" : "invalid JSON request body",
        });
        return;
      }
      if (typeof body !== "object" || body === null) {
        sendJson(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      const { expectedUseCase, expectedKind } = body as Record<string, unknown>;
      if (typeof expectedUseCase !== "string" || !USE_CASES.includes(expectedUseCase as UseCase)) {
        sendJson(res, 400, { error: '"expectedUseCase" must be a known use case' });
        return;
      }
      if (expectedKind !== undefined && expectedKind !== "claude" && expectedKind !== "codex") {
        sendJson(res, 400, { error: '"expectedKind" must be "claude" or "codex"' });
        return;
      }
      try {
        const result = await decisions.promote(decodeURIComponent(promoteMatch[1]), {
          expectedUseCase: expectedUseCase as UseCase,
          expectedKind: expectedKind as AgentKind | undefined,
        });
        if (result.status === "promoted") sendJson(res, 201, { promoted: true });
        else if (result.status === "duplicate") sendJson(res, 200, { promoted: false, message: "evaluation case already exists" });
        else sendJson(res, 404, { error: "decision not found" });
      } catch (err) {
        console.error("POST /decisions/:id/promote failed:", err);
        sendJson(res, 500, { error: "failed to promote decision" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/choose") {
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
