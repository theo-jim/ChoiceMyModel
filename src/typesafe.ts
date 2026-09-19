const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type TypeSafeAnswer = ChoiceAnswer | NoulAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface SystemOneRequest {
  state: unknown;
  model: string;
  questions: Record<string, unknown>;
}

export async function systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is not set");
  }

  const baseUrl = process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL;
  const timeoutMs = Number(process.env.TYPESAFE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  // A router sits on the request path of every message, so a stalled connection
  // must not hang the caller indefinitely.
  const response = await fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TypeSafe API ${response.status}: ${body}`);
  }

  return (await response.json()) as SystemOneResponse;
}

export function readChoice(answers: Record<string, TypeSafeAnswer>, id: string): ChoiceAnswer {
  const answer = answers[id];
  if (!answer || answer.type !== "choice") {
    throw new Error(`expected a choice answer for "${id}"`);
  }
  return answer;
}

export function readNoul(answers: Record<string, TypeSafeAnswer>, id: string): number {
  const answer = answers[id];
  if (!answer || answer.type !== "noul") {
    throw new Error(`expected a noul answer for "${id}"`);
  }
  return answer.noul;
}
