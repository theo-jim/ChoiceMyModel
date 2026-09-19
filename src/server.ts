import { createServer, type IncomingMessage } from "node:http";
import { chooseModel } from "./chooseModel.js";
import type { AgentKind, TaskState } from "./types.js";

const PORT = Number(process.env.PORT ?? 8787);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/choose") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as TaskState & { kind?: AgentKind };
      if (!body.text) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "\"text\" is required" }));
        return;
      }
      const decision = await chooseModel(
        { text: body.text, context: body.context },
        { kind: body.kind },
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(decision));
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`ChoiceMyModel listening on :${PORT}`);
});
