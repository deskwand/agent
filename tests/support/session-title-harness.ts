import { getInitialSessionTitle } from '../../src/shared/session-title';
import { maybeGenerateSessionTitle } from '../../src/main/session/session-title-flow';

type HarnessOptions = {
  generatedTitle: string | null;
  latestTitle?: string;
  /** Controls what updateTitle returns; defaults to true */
  updateTitleResult?: boolean;
};

export function createTitleFlowHarness(options: HarnessOptions) {
  let updatedTitle: string | null = null;
  let currentTitle = '';
  let generateCallCount = 0;
  const latestTitle = options.latestTitle ?? null;
  const attemptedSessions = new Set<string>();
  const sessionId = 'session-1';
  const updateTitleResult = options.updateTitleResult ?? true;

  const runFirstMessage = async (
    prompt: string,
    firstAttachmentName?: string | null,
  ) => {
    currentTitle = getInitialSessionTitle(prompt, firstAttachmentName);
    await maybeGenerateSessionTitle({
      sessionId,
      prompt,
      firstAttachmentName,
      userMessageCount: 1,
      currentTitle,
      hasAttempted: attemptedSessions.has(sessionId),
      generateTitle: async () => {
        generateCallCount += 1;
        return options.generatedTitle;
      },
      getLatestTitle: () => latestTitle ?? currentTitle,
      markAttempt: () => {
        attemptedSessions.add(sessionId);
      },
      updateTitle: async (title) => {
        if (updateTitleResult) {
          updatedTitle = title;
          currentTitle = title;
        }
        return updateTitleResult;
      },
      log: () => undefined,
    });
  };

  return {
    runFirstMessage,
    get updatedTitle() {
      return updatedTitle;
    },
    get generateCallCount() {
      return generateCallCount;
    },
    get hasAttempted() {
      return attemptedSessions.has(sessionId);
    },
  };
}
