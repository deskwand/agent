#!/usr/bin/env node
/**
 * 最小 stdio MCP server，供内置 MCP 的接入验证与回归测试使用。
 * 只依赖 @modelcontextprotocol/sdk（DeskBend 已有）。
 * 工具：echo（回显）、boom（总是抛错，用于验证失败路径）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "deskwand-fixture", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echo the provided text back.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] }),
);

server.registerTool("boom", { description: "Always fails." }, async () => {
  throw new Error("fixture-boom");
});

await server.connect(new StdioServerTransport());
