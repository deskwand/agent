import { describe, expect, it } from "vitest";
import { avatarInitials } from "../../renderer/utils/identity";

describe("avatarInitials", () => {
  it("两段 local-part 取两个首字母大写", () => {
    expect(avatarInitials("jichun.zou@eacon.com")).toBe("JZ");
  });

  it("单段 local-part 只取一个首字母", () => {
    expect(avatarInitials("zoujichun@eacon.com")).toBe("Z");
  });

  it("点/下划线/连字符都算分段符，只取前两段", () => {
    expect(avatarInitials("a_b-c@example.com")).toBe("AB");
  });

  it("空串返回空串", () => {
    expect(avatarInitials("")).toBe("");
  });

  it("无 @ 时按整串处理", () => {
    expect(avatarInitials("zoujichun")).toBe("Z");
  });
});
