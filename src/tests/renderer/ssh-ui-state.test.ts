import { describe, expect, it } from "vitest";
import { filePreviewCapability } from "../../renderer/utils/remote-capabilities";

describe("filePreviewCapability", () => {
  it("本地工作区四个能力都开", () => {
    expect(filePreviewCapability("/Users/a/proj")).toEqual({
      office: true,
      systemApp: true,
      revealInFinder: true,
      binaryPreview: true,
    });
  });

  it("远程工作区四个能力都关", () => {
    expect(filePreviewCapability("ssh://h1/srv/app")).toEqual({
      office: false,
      systemApp: false,
      revealInFinder: false,
      binaryPreview: false,
    });
  });
});
