import type { ReviewResults } from "../../types/review.js";

/** Render review results as formatted JSON. */
export function renderJson(results: ReviewResults): string {
  return JSON.stringify(results, null, 2);
}
