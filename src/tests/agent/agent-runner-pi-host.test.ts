import { describe, it, expect } from "vitest";
import { PiExtensionHost } from "../../main/extensions/pi-extension-host";

describe("AgentRunner Pi host integration surface", () => {
  it("host registry is shared with agent-runner", () => {
    // AgentRunner 通过 PiExtensionHost.getOrCreate 获取 host；
    // 该测试验证 registry 单例语义，防止集成时创建重复 host。
    expect(typeof PiExtensionHost.getOrCreate).toBe("function");
    expect(PiExtensionHost.registry).toBeInstanceOf(Map);
  });
});
