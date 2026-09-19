import { TypeSafeClient } from "@typesafe-ai/sdk";

let client: TypeSafeClient | undefined;

/**
 * Constructed on first use, not at import: the constructor throws without an
 * API key, and the Claude comparison backend must work with no TypeSafe key set.
 *
 * Configuration comes from the SDK's own environment variables —
 * TYPESAFE_API_KEY, TYPESAFE_BASE_URL, TYPESAFE_DEFAULT_MODEL, TYPESAFE_LOG_LEVEL —
 * along with its default 10s per-attempt timeout and retry policy.
 */
export function typeSafeClient(): TypeSafeClient {
  client ??= new TypeSafeClient();
  return client;
}
