/**
 * Facade for criteria discovery and file matching.
 *
 * Re-exports functions from module-parser and glob-matcher so consumers
 * can import from a single location. The underlying implementations stay
 * in their current files for now.
 */

export {
  discoverModules as discoverCriteria,
  filterModules as filterCriteria,
  parseModule as parseCriterion,
} from "../core/module-parser.js";

export {
  findMatchingModules as matchFiles,
  fileMatchesGlobs,
} from "../core/glob-matcher.js";
