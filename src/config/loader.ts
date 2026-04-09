import fs from "node:fs";
import path from "node:path";
import type { ReviewConfig } from "./types.js";

/** Default configuration applied when no .deskcheck/config.json exists or fields are missing. */
export const DEFAULT_CONFIG: ReviewConfig = {
  modules_dir: "deskcheck/criteria",
  storage_dir: ".deskcheck/runs",
  tests_dir: "deskcheck/tests",
  serve_port: 3000,
  concurrency: 5,
  defaultModel: "sonnet",
  shared: {
    allowed_tools: ["Read", "Glob", "Grep"],
    mcp_servers: {},
  },
  agents: {
    resolver: {},
    partitioner: {},
    reviewer: {},
    evaluator: { model: "haiku" },
    judge: { model: "opus" },
  },
};

/**
 * Deep-merge a partial user config on top of defaults.
 *
 * For plain objects, recursively merges keys so that user-supplied values
 * override defaults while missing nested fields retain their defaults.
 * For all other types (strings, arrays, primitives), the user value wins outright.
 */
export function deepMerge<T>(defaults: T, overrides: Partial<T>): T {
  if (
    typeof defaults !== "object" ||
    defaults === null ||
    Array.isArray(defaults)
  ) {
    return (overrides ?? defaults) as T;
  }

  const result = { ...defaults } as Record<string, unknown>;

  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const defaultVal = (defaults as Record<string, unknown>)[key];
    const overrideVal = (overrides as Record<string, unknown>)[key];

    if (overrideVal === undefined) {
      continue;
    }

    if (
      typeof defaultVal === "object" &&
      defaultVal !== null &&
      !Array.isArray(defaultVal) &&
      typeof overrideVal === "object" &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}

/**
 * Load and validate the deskcheck tool configuration.
 *
 * Reads `.deskcheck/config.json` from the given project root. If the file exists,
 * parses it and deep-merges with defaults so missing fields get default values.
 * If the file does not exist, returns the full default configuration.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns Fully populated ReviewConfig.
 * @throws {Error} If the config file exists but contains invalid JSON.
 */
export function loadConfig(projectRoot: string): ReviewConfig {
  const configPath = path.join(projectRoot, ".deskcheck", "config.json");

  if (!fs.existsSync(configPath)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const raw = fs.readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Invalid JSON in ${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Invalid config in ${configPath}: expected a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }

  return deepMerge(DEFAULT_CONFIG, parsed as Partial<ReviewConfig>);
}
