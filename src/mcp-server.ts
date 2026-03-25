#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReviewTools } from "./mcp/tools.js";
import { loadConfig } from "./config/loader.js";

const projectRoot = process.cwd();
const config = loadConfig(projectRoot);

const server = new McpServer({
  name: "deskcheck",
  version: "0.1.0",
});

registerReviewTools(server, config, projectRoot);

const transport = new StdioServerTransport();
await server.connect(transport);
