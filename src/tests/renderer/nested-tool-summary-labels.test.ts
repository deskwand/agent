import { expect, it } from "vitest";
import i18n from "../../renderer/i18n/config";
import {
  getProcessSummaryFragments,
  formatResultSummaryLabel,
  type ProcessSummary,
} from "../../renderer/utils/tool-display-blocks";
const empty: ProcessSummary = {
  readCount: 0,
  todoUpdateCount: 0,
  hasSearch: false,
  hasWebSearch: false,
  hasBrowse: false,
  hasMemory: false,
  commandCount: 0,
  subagentCount: 0,
  hasGoal: false,
  usedToolCount: 0,
};
it("shows called-tool fallbacks instead of zero-file success", async () => {
  await i18n.changeLanguage("zh");
  expect(
    getProcessSummaryFragments(
      { ...empty, calledRead: true, calledSearch: true },
      i18n.t,
    ).map((fragment) => fragment.text),
  ).toEqual(["已调用读取工具", "已调用搜索工具"]);
  expect(
    formatResultSummaryLabel(
      { editedFiles: 0, writtenFiles: 0, calledEdit: true, calledWrite: true },
      i18n.t,
    ),
  ).toContain("已调用写入工具");
});
it("distinguishes successful empty scripts from running or failed scripts with English plurals", async () => {
  await i18n.changeLanguage("en");
  expect(
    getProcessSummaryFragments({ ...empty, scriptCount: 2 }, i18n.t)[0].text,
  ).toBe("Executed 2 scripts");
  const status = {
    running: false,
    failed: true,
    unfinished: false,
    incomplete: false,
    unavailable: false,
  };
  expect(
    getProcessSummaryFragments({ ...empty, scriptCount: 1 }, i18n.t, status)[0]
      .text,
  ).toBe("Called 1 script");
  expect(
    getProcessSummaryFragments({ ...empty, scriptCount: 1 }, i18n.t, {
      ...status,
      failed: false,
      running: true,
    })[0].text,
  ).toBe("Running script");
});
