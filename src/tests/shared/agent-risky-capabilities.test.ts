import { describe, expect, it } from "vitest";
import {
  ALL_RISKY_DISABLED,
  ALL_RISKY_ENABLED,
  RISKY_CAPABILITIES,
  riskyCapabilityOf,
} from "../../shared/agent-risky-capabilities";

describe("riskyCapabilityOf", () => {
  it("classifies shell, browser and computer tools", () => {
    expect(riskyCapabilityOf("bash")).toBe("shell");
    expect(riskyCapabilityOf("Execute_Command")).toBe("shell");
    expect(riskyCapabilityOf("PowerShell")).toBe("shell");
    expect(riskyCapabilityOf("internal_browser_click")).toBe("browser");
    expect(riskyCapabilityOf("mcp__GUI_Operate__click")).toBe("computer");
  });

  it("returns null for other tools", () => {
    expect(riskyCapabilityOf("read")).toBeNull();
    expect(riskyCapabilityOf("mcp__mail__email_send")).toBeNull();
  });

  it("exposes enabled / disabled presets over every capability", () => {
    for (const key of RISKY_CAPABILITIES) {
      expect(ALL_RISKY_ENABLED[key]).toBe(true);
      expect(ALL_RISKY_DISABLED[key]).toBe(false);
    }
  });
});
