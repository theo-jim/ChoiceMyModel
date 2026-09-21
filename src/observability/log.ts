import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { resolvePackagePath } from "../packageRoot.js";
import type { AgentKind, Classification, RoutingDecision, TaskState, WorkerChoice } from "../types.js";

export interface LoggedDecision {
  id: string;
  timestamp: string;
  request: TaskState & { kind?: AgentKind };
  classification: Classification;
  decision: {
    tier: RoutingDecision["tier"];
    worker: WorkerChoice;
    escalated: boolean;
    reasons: string[];
  };
}

type Append = (filePath: string, line: string) => Promise<void>;
type Read = (filePath: string) => Promise<string>;

export interface DecisionLogOptions {
  filePath?: string;
  enabled?: boolean;
  id?: () => string;
  now?: () => Date;
  append?: Append;
  read?: Read;
  error?: (message: string) => void;
}

function defaultPath(): string {
  return resolvePackagePath("data/decisions.jsonl");
}

async function appendToFile(filePath: string, line: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, line, "utf8");
}

function reportError(options: DecisionLogOptions, message: string): void {
  (options.error ?? console.error)(message);
}

export function logDecision(
  state: TaskState,
  kind: AgentKind | undefined,
  routingDecision: RoutingDecision,
  options: DecisionLogOptions = {},
): void {
  const enabled = options.enabled ?? process.env.CHOICEMYMODEL_LOG !== "0";
  if (!enabled) return;

  const record: LoggedDecision = {
    id: (options.id ?? randomUUID)(),
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    request: { ...state, ...(kind === undefined ? {} : { kind }) },
    classification: routingDecision.classification,
    decision: {
      tier: routingDecision.tier,
      worker: routingDecision.worker,
      escalated: routingDecision.escalated,
      reasons: routingDecision.reasons,
    },
  };

  const append = options.append ?? appendToFile;
  void append(options.filePath ?? defaultPath(), `${JSON.stringify(record)}\n`).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    reportError(options, `Could not write routing decision: ${detail}`);
  });
}

export async function readLoggedDecisions(options: DecisionLogOptions = {}): Promise<LoggedDecision[]> {
  const read = options.read ?? ((filePath: string) => readFile(filePath, "utf8"));
  let contents: string;
  try {
    contents = await read(options.filePath ?? defaultPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    const detail = err instanceof Error ? err.message : String(err);
    reportError(options, `Could not read routing decisions: ${detail}`);
    return [];
  }

  const decisions: LoggedDecision[] = [];
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      decisions.push(JSON.parse(line) as LoggedDecision);
    } catch {
      reportError(options, "Could not parse a routing decision log line");
    }
  }
  return decisions;
}

export async function recentLoggedDecisions(
  limit: number,
  options: DecisionLogOptions = {},
): Promise<LoggedDecision[]> {
  const decisions = await readLoggedDecisions(options);
  return decisions
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
