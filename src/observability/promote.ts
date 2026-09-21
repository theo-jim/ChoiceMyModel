import { readFile, writeFile } from "node:fs/promises";
import { readLoggedDecisions, recentLoggedDecisions, type DecisionLogOptions } from "./log.js";
import { resolvePackagePath } from "../packageRoot.js";
import type { AgentKind, UseCase } from "../types.js";

export interface PromotionLabel {
  expectedUseCase: UseCase;
  expectedKind?: AgentKind;
}

export type PromotionResult =
  | { status: "promoted" }
  | { status: "duplicate" }
  | { status: "notFound" };

export interface DecisionStore {
  list(limit: number): Promise<Awaited<ReturnType<typeof recentLoggedDecisions>>>;
  promote(id: string, label: PromotionLabel): Promise<PromotionResult>;
}

export interface PromotionOptions extends DecisionLogOptions {
  evalCasesPath?: string;
  readEvalCases?: (filePath: string) => Promise<string>;
  writeEvalCases?: (filePath: string, contents: string) => Promise<void>;
}

function defaultEvalCasesPath(): string {
  return resolvePackagePath("src/evals/cases.ts");
}

function renderCase(id: string, text: string, label: PromotionLabel, eol: string): string {
  const fields = [
    `    id: ${JSON.stringify(id)},`,
    `    text: ${JSON.stringify(text)},`,
    `    expectedUseCase: ${JSON.stringify(label.expectedUseCase)},`,
    ...(label.expectedKind === undefined ? [] : [`    expectedKind: ${JSON.stringify(label.expectedKind)},`]),
  ];
  return `  {${eol}${fields.join(eol)}${eol}  },${eol}`;
}

export async function promoteDecision(
  decisionId: string,
  label: PromotionLabel,
  options: PromotionOptions = {},
): Promise<PromotionResult> {
  const decision = (await readLoggedDecisions(options)).find((entry) => entry.id === decisionId);
  if (!decision) return { status: "notFound" };

  const caseId = `decision-${decision.id}`;
  const filePath = options.evalCasesPath ?? defaultEvalCasesPath();
  const source = await (options.readEvalCases ?? ((path: string) => readFile(path, "utf8")))(filePath);
  if (source.includes(`id: ${JSON.stringify(caseId)}`)) return { status: "duplicate" };

  const end = source.lastIndexOf("\n];");
  if (end < 0) throw new Error("could not find EVAL_CASES closing bracket");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const updated = `${source.slice(0, end + 1)}${renderCase(caseId, decision.request.text, label, eol)}${source.slice(end + 1)}`;
  await (options.writeEvalCases ?? ((path: string, contents: string) => writeFile(path, contents, "utf8")))(filePath, updated);
  return { status: "promoted" };
}

export function createDecisionStore(options: PromotionOptions = {}): DecisionStore {
  return {
    list: (limit) => recentLoggedDecisions(limit, options),
    promote: (id, label) => promoteDecision(id, label, options),
  };
}
