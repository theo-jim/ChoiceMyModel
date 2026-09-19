import Anthropic from "@anthropic-ai/sdk";
import type { Classification, TaskState, UseCase } from "../types.js";
import { USE_CASES } from "../types.js";

const client = new Anthropic();

const CLASSIFIER_MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are a routing classifier, not an assistant. You never answer the task
itself — you only decide what KIND of task it is, in one pass, so a router can pick which model
handles it. Answer every field of the tool call. Do not hedge: pick the single best useCase even
when a task could arguably fit more than one.`;

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_task",
  description: "Classify an incoming task along the dimensions used to pick a model tier for it.",
  input_schema: {
    type: "object",
    properties: {
      useCase: {
        type: "string",
        enum: USE_CASES,
        description:
          "lookup: retrieve a known fact. analytics: compare/compute over data. " +
          "investigation: find the cause of something unknown. summarization: condense existing content. " +
          "communication: a message to a person. deliverable: a finished standalone artifact. " +
          "automation: an action that changes state in a system.",
      },
      useCaseConfidence: {
        type: "number",
        description: "How certain you are of the useCase pick, from 0 to 1.",
      },
      spansMultipleSystems: {
        type: "number",
        description: "Probability from 0 to 1 that this touches four or more distinct systems or data sources.",
      },
      hardToReverse: {
        type: "number",
        description: "Probability from 0 to 1 that a wrong answer or action is costly or hard to undo.",
      },
      craftIsMainDifficulty: {
        type: "number",
        description:
          "Probability from 0 to 1 that the main difficulty is craft (tone, polish, persuasiveness) " +
          "rather than reaching a correct decision.",
      },
      isBulkOperation: {
        type: "number",
        description:
          "Probability from 0 to 1 that this applies to many records or entities at once rather than a single one.",
      },
      isClientFacing: {
        type: "number",
        description:
          "Probability from 0 to 1 that the output will be seen by someone outside the company.",
      },
    },
    required: [
      "useCase",
      "useCaseConfidence",
      "spansMultipleSystems",
      "hardToReverse",
      "craftIsMainDifficulty",
      "isBulkOperation",
      "isClientFacing",
    ],
    additionalProperties: false,
  },
  strict: true,
};

interface ClaudeClassifierInput {
  useCase: UseCase;
  useCaseConfidence: number;
  spansMultipleSystems: number;
  hardToReverse: number;
  craftIsMainDifficulty: number;
  isBulkOperation: number;
  isClientFacing: number;
}

function renderState(state: TaskState): string {
  return state.context ? `Context: ${state.context}\n\nTask: ${state.text}` : state.text;
}

/**
 * Comparison backend. Claude reports these numbers about itself; unlike Jev's,
 * they are not calibrated against outcomes, so treat them as a baseline to
 * measure Jev against rather than an equivalent signal.
 */
export async function classifyWithClaude(state: TaskState): Promise<Classification> {
  const startedAt = Date.now();
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_task" },
    messages: [{ role: "user", content: renderState(state) }],
  });
  const latencyMs = Date.now() - startedAt;

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("classifier did not return a tool call");
  }

  const input = toolUse.input as ClaudeClassifierInput;

  return { ...input, backend: "claude", latencyMs };
}

export { CLASSIFIER_MODEL };
