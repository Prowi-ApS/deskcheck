// A small authentication module with deliberately planted issues for the
// deskcheck demo. See ../README.md for what a real review should find.

import { createHash } from "node:crypto";

// PLANT: hardcoded API key — security/secrets criterion should flag.
const STRIPE_API_KEY = "sk_live_FAKE_KEY_FOR_DESKCHECK_DEMO_DO_NOT_USE";

interface User {
  id: number;
  email: string;
  passwordHash: string;
}

const users: User[] = [];

/**
 * Authenticate a user with email + password.
 *
 * PLANT: uses MD5 for password hashing — security/crypto criterion should flag.
 * PLANT: catches errors and silently swallows them — error-handling criterion should flag.
 */
export async function login(email: string, password: string): Promise<User | null> {
  try {
    const user = users.find((u) => u.email === email);
    if (!user) return null;
    const hash = createHash("md5").update(password).digest("hex");
    if (hash === user.passwordHash) {
      return user;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Look up a user by id and return them.
 *
 * PLANT: SQL injection — string concatenation in a query string. The
 * security criterion should flag this even though it's a fake `runQuery`.
 */
export function getUserById(id: string): Promise<User | null> {
  const query = "SELECT * FROM users WHERE id = " + id;
  return runQuery(query) as Promise<User | null>;
}

declare function runQuery(sql: string): Promise<unknown>;

export function registerUser(email: string, password: string): User {
  const id = users.length + 1;
  const passwordHash = createHash("md5").update(password).digest("hex");
  const user: User = { id, email, passwordHash };
  users.push(user);
  return user;
}
