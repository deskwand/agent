/**
 * 陷阱③ 门禁：pi-mcp 声明 engines.node >= 22.19.0，而 Electron 主进程是 22.16.0，
 * 且 pi-mcp 在 DeskBand 里是惰性加载（本机 MCP 全 disabled）→ 这条路径从未被执行过。
 *
 * 本脚本在真实 Electron 运行时里用 pi-mcp 自己的 McpClient + StdioTransport 走通：
 * 连接 fixture → listTools → callTool(echo)。失败即设计 §4 陷阱③ 成立、整个替换计划作废。
 */
import { app } from "electron";
import { join } from "node:path";

async function main() {
  console.log(
    "node:",
    process.versions.node,
    "electron:",
    process.versions.electron,
  );

  const { McpClient, StdioTransport } = await import("@earendil-works/pi-mcp");
  console.log(
    "pi-mcp loaded: McpClient =",
    typeof McpClient,
    " StdioTransport =",
    typeof StdioTransport,
  );

  const transport = new StdioTransport({
    command: process.execPath,
    args: [join(process.cwd(), "scripts/mcp-fixture-server.mjs")],
    inheritEnv: true,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });

  const client = new McpClient({ name: "deskwand-spike", version: "0" });
  const info = await client.connect(transport);
  console.log(
    "connected:",
    JSON.stringify(info?.serverInfo ?? client.serverInfo),
  );

  const tools = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(","));

  const echoed = await client.callTool("echo", { text: "hi" });
  console.log("echo result:", JSON.stringify(echoed.content));

  await transport.close();
  console.log("SPIKE OK");
}

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (error) => {
      console.error("SPIKE FAILED:", error);
      app.exit(1);
    },
  );
