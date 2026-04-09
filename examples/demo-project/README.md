# Deskcheck demo project

A small TypeScript project with deliberately planted issues, used for testing the deskcheck pipeline against real Claude responses without spending much. Total cost per full run is roughly **5–15 cents** in haiku tokens.

## What's in here

```
src/
  auth.ts          ← hardcoded API key, MD5 password hashing, SQL injection
  orders.ts        ← unhandled promise, missing input validation
tests/
  orders.test.ts   ← missing test for chargeOrder (the most error-prone path)
deskcheck/
  criteria/
    security.md         ← secrets, weak hashing, SQL injection
    error-handling.md   ← unhandled promises, silent catches, missing validation
    test-coverage.md    ← public exports without test coverage
```

## Planted issues

A correct review run should surface roughly the following findings.

### `security` criterion

| File | Severity | Issue |
|---|---|---|
| `src/auth.ts` | critical | Hardcoded `STRIPE_API_KEY` with `sk_live_` prefix |
| `src/auth.ts` | critical | SQL injection in `getUserById` (`"... WHERE id = " + id`) |
| `src/auth.ts` | warning | MD5 used for password hashing in `login` and `registerUser` |

### `error-handling` criterion

| File | Severity | Issue |
|---|---|---|
| `src/auth.ts` | warning | Empty catch block in `login` swallows all errors |
| `src/orders.ts` | critical | `chargeOrder` calls `chargeCard()` without awaiting — fire-and-forget on a payment path |
| `src/orders.ts` | warning | `calculateDiscount` doesn't validate `itemCount > 0` (division by zero) |

### `test-coverage` criterion

| File | Severity | Issue |
|---|---|---|
| `tests/orders.test.ts` + `src/orders.ts` | warning | `chargeOrder` is exported but has no test |

That's roughly 7 findings across 3 criteria — a good cross-section of severities and reference patterns to verify the UI renders things correctly.

## Running it

**One-time setup.** Initialize a git repo inside this directory so deskcheck doesn't pick up unrelated files from any enclosing parent repo:

```sh
cd examples/demo-project
git init -q && git add -A && git commit -qm "demo baseline"
```

(If you skip this, `deskcheck diff` may resolve against a parent repo's git state and produce confusing results. The natural-language commands below don't have this problem.)

**Run a real review (costs ~5–15¢):**

```sh
# Natural-language path — uses the resolver agent to pick files from src/.
deskcheck "review src/"

# Or, if you want to see live updates in the dashboard:
deskcheck serve --port 3001 &
deskcheck "review src/"
# Open http://localhost:3001 and click into the run while it's executing.
```

A full run spawns: one resolver agent, three partitioner agents (one per matched criterion), then one reviewer agent per subtask. For this project that's roughly 1 + 3 + 5 ≈ 9 agent calls, all on haiku.

## Iterating

If you change a planted issue (e.g. fix the SQL injection) and re-run, you should see one fewer finding. Useful for verifying the reviewer is actually reading the source rather than guessing.

If you want to see a partitioner failure, edit one of the criteria's `partition` field to something contradictory like `"one task per file but also group all files together"` — the partitioner agent will likely produce something the validator rejects, and you'll see the failed-run state in the dashboard.
