import { getClassifier } from "../classify.js";
import { DEFAULT_ROUTING_TABLE, DEFAULT_THRESHOLDS, route } from "../routingTable.js";
import type { ClassifierBackend, UseCase } from "../types.js";
import { EVAL_CASES } from "./cases.js";

interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  const backend = (process.env.CLASSIFIER as ClassifierBackend | undefined) ?? "jev";
  const classify = getClassifier(backend);

  const metrics = new Map<UseCase, ClassMetrics>();
  const bump = (useCase: UseCase): ClassMetrics => {
    if (!metrics.has(useCase)) metrics.set(useCase, { tp: 0, fp: 0, fn: 0 });
    return metrics.get(useCase)!;
  };

  const rows: {
    id: string;
    expected: UseCase;
    got: UseCase;
    confidence: string;
    tier: string;
    ms: number;
    ok: boolean;
  }[] = [];
  const latencies: number[] = [];
  let correct = 0;

  console.log(`Backend: ${backend}\n`);

  for (const evalCase of EVAL_CASES) {
    const classification = await classify({ text: evalCase.text });
    const decision = route(classification, DEFAULT_ROUTING_TABLE, DEFAULT_THRESHOLDS);
    const ok = classification.useCase === evalCase.expectedUseCase;

    if (ok) {
      correct++;
      bump(evalCase.expectedUseCase).tp++;
    } else {
      bump(evalCase.expectedUseCase).fn++;
      bump(classification.useCase).fp++;
    }

    latencies.push(classification.latencyMs);
    rows.push({
      id: evalCase.id,
      expected: evalCase.expectedUseCase,
      got: classification.useCase,
      confidence: classification.useCaseConfidence.toFixed(2),
      tier: decision.tier,
      ms: classification.latencyMs,
      ok,
    });
  }

  console.table(rows);

  let macroPrecision = 0;
  let macroRecall = 0;
  let classCount = 0;

  console.log("\nPer use-case:");
  for (const [useCase, m] of metrics) {
    const precision = m.tp + m.fp === 0 ? 1 : m.tp / (m.tp + m.fp);
    const recall = m.tp + m.fn === 0 ? 1 : m.tp / (m.tp + m.fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    console.log(`  ${useCase.padEnd(14)} P=${precision.toFixed(2)}  R=${recall.toFixed(2)}  F1=${f1.toFixed(2)}`);
    macroPrecision += precision;
    macroRecall += recall;
    classCount++;
  }

  const accuracy = correct / EVAL_CASES.length;
  console.log(`\nAccuracy:        ${(accuracy * 100).toFixed(1)}% (${correct}/${EVAL_CASES.length})`);
  console.log(`Macro precision: ${(macroPrecision / classCount).toFixed(2)}`);
  console.log(`Macro recall:    ${(macroRecall / classCount).toFixed(2)}`);
  console.log(`Latency p50:     ${percentile(latencies, 50)}ms`);
  console.log(`Latency p95:     ${percentile(latencies, 95)}ms`);
  console.log(
    `\nRun the other backend with CLASSIFIER=${backend === "jev" ? "claude" : "jev"} npm run eval ` +
      "to compare agreement, latency, and cost the way the post does.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
