/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * Email MCP Server - Clean, flexible email operations
 * Supports both SMTP (sending) and IMAP (reading) operations
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
// [DeskWand] relative imports drop the `.js` extension; the two removed handlers
// (`emails_modify` / `folders_list`) and the dotenv loader are gone.
import { EMAIL_TOOLS } from "./tools";
import {
  handleAccountsList,
  handleEmailsFind,
  handleEmailSend,
  handleEmailRespond,
  handleSaveAttachment,
} from "./handlers";

/**
 * Main server function.
 *
 * [DeskWand] 入口从本模块移到 `../mail-server.ts` —— 这里只导出函数，不再自己启动。
 */
export async function runMailServer(): Promise<void> {
  try {
    // Initialize the server.
    // [DeskWand] name 固定为 `Mail`：工具名是 `mcp__Mail__<tool>`，改名会变更工具声明、
    // 破坏提示词缓存并让老会话的工具调用记录对不上（AGENTS.md §5）。
    const server = new Server(
      {
        name: "Mail",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // [DeskWand] 默认静默：MCP 走 stdio，任何写 stdout 的东西都会污染协议。
    // 调试时用 DESKWAND_MAIL_DEBUG=1 打开 —— 写到 stderr，不是 stdout。
    server.onerror = (error) => {
      if (process.env.DESKWAND_MAIL_DEBUG === "1") {
        process.stderr.write(`[mail] ${String(error)}\n`);
      }
    };

    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Object.values(EMAIL_TOOLS),
      };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        switch (name) {
          case "accounts_list":
            result = await handleAccountsList();
            break;

          case "emails_find":
            result = await handleEmailsFind(args);
            break;

          case "email_send":
            result = await handleEmailSend(args);
            break;

          case "email_respond":
            result = await handleEmailRespond(args);
            break;

          case "emails_save_attachment":
            result = await handleSaveAttachment(args);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        const parsedResult = JSON.parse(result);

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
          ...(parsedResult.success === false ? { isError: true } : {}),
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: error.message || "Unknown error occurred",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    });

    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    // [DeskWand] stderr，不是 stdout —— stdout 是协议通道。
    console.error(`Server failed to start: ${error}`);
    process.exit(1);
  }
}
