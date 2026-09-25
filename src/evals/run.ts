import { classifyWithJev } from "../classifiers/jev.js";
import { route } from "../routingTable.js";
import type { AgentKind, UseCase } from "../types.js";
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
    vendor: AgentKind;
    expectedVendor: AgentKind | "";
    model: string;
    ms: number;
    ok: boolean;
  }[] = [];
  const latencies: number[] = [];
  let correct = 0;
  let vendorCorrect = 0;
  let vendorTotal = 0;

  // No `kind` passed to route(): the eval exercises Jev's own vendor pick
  // (the default vendor table plus the solutionShape override), not an
  // override from HERD_KIND.
  for (const evalCase of EVAL_CASES) {
    const classification = await classifyWithJev({ text: evalCase.text });
    const decision = route(classification);
    const ok = classification.useCase === evalCase.expectedUseCase;

    if (ok) {
      correct++;
      bump(evalCase.expectedUseCase).tp++;
    } else {
      bump(evalCase.expectedUseCase).fn++;
      bump(classification.useCase).fp++;
    }

    if (evalCase.expectedKind) {
      vendorTotal++;
      if (decision.worker.kind === evalCase.expectedKind) vendorCorrect++;
    }

    latencies.push(classification.latencyMs);
    rows.push({
      id: evalCase.id,
      expected: evalCase.expectedUseCase,
      got: classification.useCase,
      confidence: classification.useCaseConfidence.toFixed(2),
      vendor: decision.worker.kind,
      expectedVendor: evalCase.expectedKind ?? "",
      model: decision.worker.model,
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
  if (vendorTotal > 0) {
    console.log(
      `Vendor accuracy: ${((vendorCorrect / vendorTotal) * 100).toFixed(1)}% ` +
        `(${vendorCorrect}/${vendorTotal} annotated cases)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
