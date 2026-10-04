/**
 * `Mail` MCP server 的入口。**这个名字不能改** —— `scripts/bundle-mcp.js` 按它
 * 产出 `dist-mcp/mail-server.js`，而 `mailServerConfig()` 按相对路径找到它。
 *
 * 与 `gui-operate-server.ts` 同一形态：一个薄入口，实现都在 `./mail/`。
 * ⚠️ 绝不向 stdout 写任何东西 —— stdio 是协议通道。
 */
import { runMailServer } from "./mail";

void runMailServer();
