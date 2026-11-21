/**
 * Hello Tool - Minimal custom tool example
 */

// pi-ai 1.5.0 起主入口不再 re-export TypeBox（扩展在运行期由 pi 的 loader
// 别名补上 Type），编译期从已安装的 TypeBox 取类型。
import { Type } from "@sinclair/typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const helloTool = defineTool({
	name: "hello",
	label: "Hello",
	description: "A simple greeting tool",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text", text: `Hello, ${params.name}!` }],
			details: { greeted: params.name },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(helloTool);
}
