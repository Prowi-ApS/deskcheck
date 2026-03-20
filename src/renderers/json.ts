import type { ReviewResults } from "../core/types.js";

/** Render review results as formatted JSON. */
export function renderJson(results: ReviewResults): string {
  return JSON.stringify(results, null, 2);
}
