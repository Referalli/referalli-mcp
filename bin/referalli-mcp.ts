#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfirmationStore, TOOLS, type ToolContext } from '../src/tools.js';
import { DEFAULT_BASE_URL, VERSION } from '../src/version.js';

if (process.argv.includes('--version')) {
  console.log(VERSION);
  process.exit(0);
}

const ctx: ToolContext = {
  baseUrl: (process.env.REFERALLI_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  apiKey: process.env.REFERALLI_API_KEY ?? '',
  confirmations: new ConfirmationStore(),
};
if (!ctx.apiKey) {
  // stdout is the MCP channel; diagnostics go to stderr.
  console.error('Set REFERALLI_API_KEY to a Referalli API key (rk_test_… or rk_live_…, from Settings → API keys).');
  process.exit(1);
}

const server = new McpServer({ name: 'referalli', version: VERSION });
for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.input,
      // Writes never act without a second, confirmed call; say so to the client too.
      annotations: tool.write ? { readOnlyHint: false, destructiveHint: true } : { readOnlyHint: true },
    },
    async (args: Record<string, unknown>) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await tool.run(ctx, args), null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text' as const, text: (err as Error).message }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
