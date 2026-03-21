/**
 * Shared multi-session Playwright MCP library.
 *
 * Provides:
 * - PlaywrightSessionManager: manages multiple isolated browser contexts,
 *   injects session_id into upstream Playwright tools, and supports custom tools.
 * - startServer(): bootstrap helper that wires up config, factory, and MCP server.
 *
 * Consumers (playwright-server.cjs) require this module
 * and pass their custom tools + hooks via options.
 */

// Resolve modules from the @playwright/mcp npx cache, NOT the project's node_modules.
// The project's playwright package restricts exports and doesn't expose internal paths.
const MCP_MODULES = process.env.PLAYWRIGHT_MCP_NODE_MODULES;
if (!MCP_MODULES) {
  console.error('PLAYWRIGHT_MCP_NODE_MODULES not set. Run via a launcher script (e.g. playwright.sh).');
  process.exit(1);
}
const pw = (mod) => require(`${MCP_MODULES}/${mod}`);

const { Context } = pw('playwright/lib/mcp/browser/context');
const { resolveConfig } = pw('playwright/lib/mcp/browser/config');
const { contextFactory } = pw('playwright/lib/mcp/browser/browserContextFactory');
const { filteredTools } = pw('playwright/lib/mcp/browser/tools');
const { Response } = pw('playwright/lib/mcp/browser/response');
const { toMcpTool } = pw('playwright/lib/mcp/sdk/tool');
const mcpServer = pw('playwright/lib/mcp/sdk/server');
const mcpBundle = pw('playwright-core/lib/mcpBundle');
const { setupExitWatchdog } = pw('playwright/lib/mcp/browser/watchdog');

const z = mcpBundle.z;

/**
 * Multi-session backend for Playwright MCP.
 *
 * Each session_id gets its own isolated browser context. When session_id is
 * omitted from tool calls, a "default" session is used, making this fully
 * backward-compatible with single-agent usage.
 *
 * Extension points:
 * - onContextCreated(context, sessionId): called when a new Context is created
 * - customTools: array of { definition, handler(args, sessionManager) }
 */
class PlaywrightSessionManager {
  /**
   * @param {object} config - Resolved Playwright config
   * @param {object} factory - Browser context factory
   * @param {object} [options]
   * @param {function} [options.onContextCreated] - Called with (context, sessionId) when a new session Context is created
   * @param {Array<{definition: object, handler: function}>} [options.customTools] - Consumer-defined tools
   */
  constructor(config, factory, options = {}) {
    this._config = config;
    this._factory = factory;
    this._contexts = new Map();
    this._tools = filteredTools(config);
    this._sessionCounter = 0;
    this._onContextCreated = options.onContextCreated || null;
    this._customTools = options.customTools || [];
  }

  async initialize(clientInfo) {
    this._clientInfo = clientInfo;
  }

  /**
   * Get or create a Context for the given session ID.
   */
  getContext(sessionId) {
    if (!this._contexts.has(sessionId)) {
      const context = new Context({
        config: this._config,
        browserContextFactory: this._factory,
        sessionLog: undefined,
        clientInfo: this._clientInfo,
      });

      if (this._onContextCreated) {
        this._onContextCreated(context, sessionId);
      }

      this._contexts.set(sessionId, context);
    }
    return this._contexts.get(sessionId);
  }

  hasSession(sessionId) {
    return this._contexts.has(sessionId);
  }

  listSessions() {
    return Array.from(this._contexts.keys());
  }

  async closeSession(sessionId) {
    const context = this._contexts.get(sessionId);
    if (context) {
      await context.dispose();
      this._contexts.delete(sessionId);
    }
  }

  async listTools() {
    // Standard Playwright tools with optional session_id added to each
    const standardTools = this._tools.map(tool => {
      const extendedInputSchema = tool.schema.inputSchema.extend({
        session_id: z.string().optional().describe(
          'Browser session ID for multi-agent isolation. Omit for default session.'
        ),
      });
      return toMcpTool({
        ...tool.schema,
        inputSchema: extendedInputSchema,
      });
    });

    // Built-in session management tools
    const sessionTools = [
      {
        name: 'create_session',
        title: 'Create browser session',
        description: 'Create a new isolated browser session with its own cookies, storage, and page state. Returns a session_id to pass to other browser tools. Each session is fully independent — navigation in one session does not affect others.',
        inputSchema: z.toJSONSchema(z.object({})),
        annotations: {
          title: 'Create browser session',
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'close_session',
        title: 'Close browser session',
        description: 'Close a browser session and release its resources (browser context, pages).',
        inputSchema: z.toJSONSchema(z.object({
          session_id: z.string().describe('The session ID to close'),
        })),
        annotations: {
          title: 'Close browser session',
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
    ];

    // Consumer-provided custom tools
    const consumerTools = this._customTools.map(t => t.definition);

    return [...standardTools, ...sessionTools, ...consumerTools];
  }

  async callTool(name, rawArguments) {
    // Handle built-in session tools
    if (name === 'create_session') return this._handleCreateSession();
    if (name === 'close_session') return this._handleCloseSession(rawArguments);

    // Handle consumer-provided custom tools
    const customTool = this._customTools.find(t => t.definition.name === name);
    if (customTool) {
      return customTool.handler(rawArguments, this);
    }

    // Standard Playwright tool: extract session_id, route to correct context
    const sessionId = rawArguments?.session_id || 'default';

    // Strip session_id from args before passing to the tool handler
    // (the original Zod schema doesn't know about it)
    const toolArgs = { ...rawArguments };
    delete toolArgs.session_id;

    const tool = this._tools.find(t => t.schema.name === name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `### Error\nTool "${name}" not found` }],
        isError: true,
      };
    }

    const context = this.getContext(sessionId);
    const parsedArguments = tool.schema.inputSchema.parse(toolArgs);
    // Force file output (screenshots, etc.) into the .playwright-mcp/ directory
    // instead of the project root, so they're covered by .gitignore.
    const cwd = process.env.PLAYWRIGHT_OUTPUT_DIR || rawArguments?._meta?.cwd;
    const response = new Response(context, name, parsedArguments, cwd);
    context.setRunningTool(name);

    try {
      await tool.handle(context, parsedArguments, response);
      return await response.serialize();
    } catch (error) {
      return {
        content: [{ type: 'text', text: `### Error\n${String(error)}` }],
        isError: true,
      };
    } finally {
      context.setRunningTool(undefined);
    }
  }

  async _handleCreateSession() {
    const sessionId = `session-${++this._sessionCounter}`;
    this.getContext(sessionId); // pre-create the context
    return {
      content: [{
        type: 'text',
        text: `### Result\nCreated browser session: \`${sessionId}\`\n\nPass this as \`session_id\` in all subsequent browser tool calls to use this isolated session.`,
      }],
    };
  }

  async _handleCloseSession(args) {
    const sessionId = args?.session_id;
    if (!sessionId) {
      return {
        content: [{ type: 'text', text: '### Error\nsession_id is required' }],
        isError: true,
      };
    }
    if (!this._contexts.has(sessionId)) {
      return {
        content: [{ type: 'text', text: `### Error\nSession "${sessionId}" not found` }],
        isError: true,
      };
    }
    await this.closeSession(sessionId);
    return {
      content: [{ type: 'text', text: `### Result\nClosed session: ${sessionId}` }],
    };
  }

  serverClosed() {
    for (const [, context] of this._contexts) {
      context.dispose().catch(() => {});
    }
    this._contexts.clear();
  }
}

/**
 * Bootstrap and start a multi-session Playwright MCP server.
 *
 * @param {object} options
 * @param {string} options.name - Server display name (e.g. "Playwright")
 * @param {string} options.nameInConfig - Config key (e.g. "playwright")
 * @param {string} [options.version='0.1.0'] - Server version
 * @param {object} [options.browserConfig] - Override default browser config
 * @param {function} [options.onContextCreated] - Called with (context, sessionId)
 * @param {Array<{definition: object, handler: function}>} [options.customTools] - Custom tools
 */
async function startServer(options) {
  setupExitWatchdog();

  // Determine headless mode: headed when DISPLAY is set, headless otherwise
  const headless = !process.env.DISPLAY;

  const defaultBrowserConfig = {
    browserName: 'chromium',
    isolated: true, // Required: allows multiple browser contexts on one browser
    launchOptions: {
      headless,
    },
    contextOptions: {
      viewport: null,
    },
  };

  const browserConfig = options.browserConfig
    ? { ...defaultBrowserConfig, ...options.browserConfig }
    : defaultBrowserConfig;

  const config = await resolveConfig({
    browser: browserConfig,
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || undefined,
  });

  // Override the default chrome channel — use the bundled MCP Chromium instead
  delete config.browser.launchOptions.channel;

  const factory = contextFactory(config);

  const serverFactory = {
    name: options.name,
    nameInConfig: options.nameInConfig,
    version: options.version || '0.1.0',
    create: () => new PlaywrightSessionManager(config, factory, {
      onContextCreated: options.onContextCreated,
      customTools: options.customTools,
    }),
  };

  await mcpServer.start(serverFactory, config.server);
}

module.exports = { PlaywrightSessionManager, startServer, z, pw };
