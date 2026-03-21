#!/usr/bin/env node
/**
 * Generic multi-session Playwright MCP server.
 *
 * Pure Playwright with multi-session support — no app-specific tools.
 * Uses the shared PlaywrightSessionManager for session isolation.
 */

const { startServer } = require('./lib/session-manager.cjs');

startServer({
  name: 'Playwright',
  nameInConfig: 'playwright',
  version: '0.1.0',
}).catch(error => {
  console.error('Failed to start Playwright MCP server:', error);
  process.exit(1);
});
