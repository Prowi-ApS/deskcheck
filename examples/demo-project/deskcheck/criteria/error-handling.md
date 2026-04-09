---
description: Error handling and async correctness
globs:
  - "src/**/*.ts"
partition: one task per file
model: haiku
---

You check TypeScript code for these specific error-handling issues only:

1. **Unhandled promise rejections** — a function that returns or calls a promise without awaiting it or attaching `.catch()`, especially in non-async contexts where the promise is fire-and-forget.
2. **Empty / silent catch blocks** — `catch { }` or `catch (e) { /* nothing */ }` that swallow errors without logging or rethrowing. Acceptable: a catch block that logs or maps to a typed error.
3. **Missing input validation** at function boundaries that could lead to runtime errors (e.g. division by zero, null dereference of an obviously-nullable param).

**Severity:**
- `critical` for fire-and-forget promises in payment / auth / data-mutation paths.
- `warning` for silent catch blocks and missing input validation.
- `info` for nothing in this criterion.

**Do not check** anything else. No style, no naming, no security (separate criterion handles that). Return an empty array if the file is clean.
