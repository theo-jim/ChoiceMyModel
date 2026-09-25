import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, type TomlTable } from "smol-toml";
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
 * Codex picks its active profile's model over the top-level one when
 * `profile` is set, so a resolver reading the same file has to respect the
 * same precedence — otherwise it would report a model Codex itself never
 * actually uses.
 */
function extractModel(config: TomlTable): string | undefined {
  const activeProfileName = typeof config.profile === "string" ? config.profile : undefined;
  const profiles = config.profiles as TomlTable | undefined;
  const activeProfile = activeProfileName ? (profiles?.[activeProfileName] as TomlTable | undefined) : undefined;
  const profileModel = activeProfile?.model;

  if (typeof profileModel === "string") return profileModel;
  return typeof config.model === "string" ? config.model : undefined;
}

/**
 * Resolves the Codex model id for a tier by reading the version the user has
 * configured for the Codex CLI itself, so the roster never hardcodes a model
 * id that will drift out of sync with what Codex actually resolves.
 *
 * Fails loudly (not a silent fallback) when the config is missing, unreadable,
 * invalid TOML, or the model value doesn't match the expected shape: a stale
 * hardcoded id that silently keeps working is worse than a routing call that
 * errors out.
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

  let config: TomlTable;
  try {
    config = parse(contents);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse the Codex config at ${configPath} as TOML (${detail}). Check its syntax.`);
  }

  const model = extractModel(config);
  if (model === undefined) {
    throw new Error(
      `No "model" key found in ${configPath} (checked the active profile's table first, then the ` +
        'top level). Set model = "gpt-<version>", either at the top level or inside the table for ' +
        "the profile named by the top-level \"profile\" key.",
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
