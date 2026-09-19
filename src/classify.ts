import { classifyWithClaude } from "./classifiers/claude.js";
import { classifyWithJev } from "./classifiers/jev.js";
import type { Classifier, ClassifierBackend } from "./types.js";

const CLASSIFIERS: Record<ClassifierBackend, Classifier> = {
  jev: classifyWithJev,
  claude: classifyWithClaude,
};

export function getClassifier(backend?: ClassifierBackend): Classifier {
  const selected = backend ?? (process.env.CLASSIFIER as ClassifierBackend | undefined) ?? "jev";
  const classifier = CLASSIFIERS[selected];
  if (!classifier) {
    throw new Error(`unknown classifier backend "${selected}" (expected "jev" or "claude")`);
  }
  return classifier;
}

export { classifyWithClaude, classifyWithJev };
