import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { AgentModel, ReviewModule } from "../../types/criteria.js";

const VALID_MODELS: ReadonlySet<string> = new Set<AgentModel>([
  "haiku",
  "sonnet",
  "opus",
]);

const DEFAULT_PARTITION = "one task per matched file";
const DEFAULT_MODEL: AgentModel = "haiku";

/**
 * Parse a single criterion markdown file into a ReviewModule object.
 *
 * Reads the file, extracts YAML frontmatter with `gray-matter`, validates
 * required fields, applies defaults for optional fields, and returns the
 * structured criterion representation.
 *
 * @param filePath - Absolute or relative path to the markdown file.
 * @param basePath - Base directory used to compute relative paths and criterion IDs.
 * @returns Parsed ReviewModule.
 * @throws {Error} If the file cannot be read or frontmatter is invalid.
 */
export function parseModule(filePath: string, basePath: string): ReviewModule {
  const absolutePath = path.resolve(filePath);
  const absoluteBase = path.resolve(basePath);

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const { data: frontmatter, content } = matter(raw);

  const relativePath = path.relative(absoluteBase, absolutePath);
  const relativeFile = path.relative(path.dirname(absoluteBase), absolutePath);

  // --- Validate required fields ---

  if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
    throw new Error(
      `Invalid criterion ${relativePath}: "description" is required and must be a non-empty string`,
    );
  }

  if (!Array.isArray(frontmatter.globs) || frontmatter.globs.length === 0) {
    throw new Error(
      `Invalid criterion ${relativePath}: "globs" is required and must be a non-empty array of strings`,
    );
  }

  for (const glob of frontmatter.globs) {
    if (typeof glob !== "string" || glob.trim() === "") {
      throw new Error(
        `Invalid criterion ${relativePath}: each entry in "globs" must be a non-empty string. Got: ${JSON.stringify(glob)}`,
      );
    }
  }

  // --- Apply defaults for optional fields ---

  const partition =
    typeof frontmatter.partition === "string" && frontmatter.partition.trim() !== ""
      ? frontmatter.partition
      : DEFAULT_PARTITION;

  const model = frontmatter.model ?? DEFAULT_MODEL;
  if (!VALID_MODELS.has(model)) {
    throw new Error(
      `Invalid criterion ${relativePath}: "model" must be one of: ${[...VALID_MODELS].join(", ")}. Got: ${JSON.stringify(model)}`,
    );
  }

  // tools — optional array of strings, defaults to empty.
  let tools: string[] = [];
  if (frontmatter.tools !== undefined) {
    if (!Array.isArray(frontmatter.tools)) {
      throw new Error(
        `Invalid criterion ${relativePath}: "tools" must be an array of strings. Got: ${JSON.stringify(frontmatter.tools)}`,
      );
    }
    for (const t of frontmatter.tools) {
      if (typeof t !== "string" || t.trim() === "") {
        throw new Error(
          `Invalid criterion ${relativePath}: each entry in "tools" must be a non-empty string. Got: ${JSON.stringify(t)}`,
        );
      }
    }
    tools = frontmatter.tools as string[];
  }

  // --- Build the criterion ID from relative path without extension ---

  const id = relativePath.replace(/\.md$/, "").split(path.sep).join("/");

  return {
    id,
    file: relativeFile.split(path.sep).join("/"),
    description: frontmatter.description,
    globs: frontmatter.globs as string[],
    partition,
    model: model as AgentModel,
    tools,
    prompt: content.trim(),
  };
}

/**
 * Discover all criteria by recursively scanning a directory for `.md` files.
 *
 * Each markdown file is parsed for YAML frontmatter containing criterion metadata
 * (description, globs, etc.) and the markdown body becomes the detective prompt.
 *
 * @param modulesDir - Path to the directory containing criterion markdown files.
 * @returns Array of parsed ReviewModule objects, sorted by ID for deterministic ordering.
 * @throws {Error} If the directory does not exist or any criterion file has invalid frontmatter.
 */
export function discoverModules(modulesDir: string): ReviewModule[] {
  const absoluteDir = path.resolve(modulesDir);

  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Criteria directory does not exist: ${absoluteDir}`);
  }

  const entries = fs.readdirSync(absoluteDir, { recursive: true }) as string[];

  const mdFiles = entries
    .filter((entry) => entry.endsWith(".md"))
    .sort();

  const modules: ReviewModule[] = [];

  for (const relativeFile of mdFiles) {
    const absoluteFile = path.join(absoluteDir, relativeFile);
    modules.push(parseModule(absoluteFile, absoluteDir));
  }

  return modules.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Filter modules by criteria name patterns.
 *
 * Each pattern is matched against the module ID. A match occurs if the
 * pattern equals the full ID or the final segment (filename without path).
 * For example, "dto-enforcement" matches "architecture/dto-enforcement".
 *
 * @param modules - All discovered modules.
 * @param patterns - Criteria name patterns to include (e.g., ["dto-enforcement", "backend/controller-conventions"]).
 * @returns Filtered modules. Throws if any pattern matched nothing.
 */
export function filterModules(modules: ReviewModule[], patterns: string[]): ReviewModule[] {
  const filtered: ReviewModule[] = [];
  const unmatchedPatterns: string[] = [];

  for (const pattern of patterns) {
    const normalized = pattern.trim().toLowerCase();
    const matches = modules.filter((m) => {
      const id = m.id.toLowerCase();
      const lastSegment = id.split("/").pop() ?? id;
      return id === normalized || lastSegment === normalized;
    });

    if (matches.length === 0) {
      unmatchedPatterns.push(pattern);
    } else {
      for (const match of matches) {
        if (!filtered.some((f) => f.id === match.id)) {
          filtered.push(match);
        }
      }
    }
  }

  if (unmatchedPatterns.length > 0) {
    const available = modules.map((m) => m.id).join(", ");
    throw new Error(
      `No criteria matched: ${unmatchedPatterns.join(", ")}. Available: ${available}`,
    );
  }

  return filtered.sort((a, b) => a.id.localeCompare(b.id));
}
