import { classify } from "../classify.js";
import { DEFAULT_ROUTING_TABLE, route } from "../routingTable.js";
import type { UseCase } from "../types.js";
import { EVAL_CASES } from "./cases.js";

interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
}

async function main() {
  const metrics = new Map<UseCase, ClassMetrics>();
  const bump = (useCase: UseCase): ClassMetrics => {
    if (!metrics.has(useCase)) metrics.set(useCase, { tp: 0, fp: 0, fn: 0 });
    return metrics.get(useCase)!;
  };

  const rows: { id: string; expected: UseCase; got: UseCase; tier: string; ok: boolean }[] = [];
  let correct = 0;

  for (const evalCase of EVAL_CASES) {
    const classification = await classify({ text: evalCase.text });
    const decision = route(classification, DEFAULT_ROUTING_TABLE);
    const ok = classification.useCase === evalCase.expectedUseCase;

    if (ok) {
      correct++;
      bump(evalCase.expectedUseCase).tp++;
    } else {
      bump(evalCase.expectedUseCase).fn++;
      bump(classification.useCase).fp++;
    }

    rows.push({
      id: evalCase.id,
      expected: evalCase.expectedUseCase,
      got: classification.useCase,
      tier: decision.tier,
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
  console.log(`\nAccuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${EVAL_CASES.length})`);
  console.log(`Macro precision: ${(macroPrecision / classCount).toFixed(2)}`);
  console.log(`Macro recall:    ${(macroRecall / classCount).toFixed(2)}`);
  console.log(
    "\nUse this to tune DEFAULT_ROUTING_TABLE — a use case that keeps missing isn't a classifier bug " +
      "until you've checked the prompt's category descriptions against your real traffic.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
