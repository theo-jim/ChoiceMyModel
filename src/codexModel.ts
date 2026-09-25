import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Tier } from "./types.js";

/** Injectable so tests can stub the file read without touching the real filesystem. */
export type CodexConfigReader = (configPath: string) => Promise<string>;

const DEFAULT_CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");

/** Matches a bare version ("gpt-5.6") or one already carrying a tier suffix ("gpt-5.6-sol"). */
const CODEX_MODEL_PATTERN = /^(gpt-[\d.]+)(?:-(?:luna|terra|sol))?$/;

const TIER_SUFFIX: Record<Tier, "luna" | "terra" | "sol"> = {
  light: "luna",
  mid: "terra",
  frontier: "sol",
};

async function readConfigFile(configPath: string): Promise<string> {
  return readFile(configPath, "utf8");
}

/**
 * Extracts the top-level `model` key from a Codex config.toml, ignoring keys
 * inside any table ([profiles.*] or otherwise) since those are per-profile
 * overrides, not the CLI's default.
 */
function extractTopLevelModel(toml: string): string | undefined {
  let inTopLevel = true;
  let model: string | undefined;

  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel || line.startsWith("#")) continue;
    const match = line.match(/^model\s*=\s*"([^"]+)"/);
    if (match) model = match[1];
  }

  return model;
}

/**
 * Resolves the Codex model id for a tier by reading the version the user has
 * configured for the Codex CLI itself, so the roster never hardcodes a model
 * id that will drift out of sync with what Codex actually resolves.
 *
 * Fails loudly (not a silent fallback) when the config is missing, unreadable,
 * or the model value doesn't match the expected shape: a stale hardcoded id
 * that silently keeps working is worse than a routing call that errors out.
 */
export async function resolveCodexModel(
  tier: Tier,
  configPath: string = DEFAULT_CODEX_CONFIG_PATH,
  readConfig: CodexConfigReader = readConfigFile,
): Promise<string> {
  let contents: string;
  try {
    contents = await readConfig(configPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read the Codex config at ${configPath} (${detail}). ` +
        "Check that Codex is installed and has been run at least once, or pass an explicit config path.",
    );
  }

  const model = extractTopLevelModel(contents);
  if (model === undefined) {
    throw new Error(
      `No top-level "model" key found in ${configPath}. ` +
        'Set model = "gpt-<version>" outside any [profiles.*] table.',
    );
  }

  const match = model.match(CODEX_MODEL_PATTERN);
  if (!match) {
    throw new Error(
      `Codex config model "${model}" in ${configPath} does not match the expected ` +
        'gpt-<version>[-luna|-terra|-sol] shape. Check the "model" key in ~/.codex/config.toml.',
    );
  }

  return `${match[1]}-${TIER_SUFFIX[tier]}`;
}
