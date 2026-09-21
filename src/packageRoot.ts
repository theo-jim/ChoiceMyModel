import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Resolves package-owned files independently of the caller's working directory. */
export function resolvePackagePath(...paths: string[]): string {
  return resolve(packageRoot, ...paths);
}
