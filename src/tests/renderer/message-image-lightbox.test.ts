// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../renderer/i18n/config";
import { MessageCard } from "../../renderer/components/MessageCard";
import { useAppStore } from "../../renderer/store";
import type { ContentBlock, ImageContent, Message } from "../../renderer/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE_BLOCK: ImageContent = {
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: "aGVsbG8=",
  },
};

const SECOND_IMAGE_BLOCK: ImageContent = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "d29ybGQ=" },
};

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    role: "user",
    sessionId: "s1",
    content: [{ type: "text", text: "look at this" }, IMAGE_BLOCK],
    timestamp: Date.now(),
    turnId: "turn-1",
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("i18nextLng", "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAppStore.setState({ lightboxImages: [], lightboxIndex: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useAppStore.setState({ sessionStates: {}, lightboxImages: [] });
});

function renderCard(
  message: Message,
  sessionMessages: Message[],
  projected = false,
) {
  useAppStore.setState({
    sessionStates: {
      s1: {
        ...useAppStore.getState().sessionStates.s1,
        historyHydrated: true,
        messages: sessionMessages,
      },
    },
  } as never);
  act(() => {
    root.render(
      React.createElement(MessageCard, {
        message,
        isLatestRound: false,
        toolBlocksProjected: projected,
        toolLookupBlocks: projected
          ? (assistantBlocksOf(sessionMessages) as ContentBlock[])
          : undefined,
      }),
    );
  });
}

/** ChatView 的 turnBlocksById 只收集 assistant 块。 */
function assistantBlocksOf(messages: Message[]): ContentBlock[] {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.content as ContentBlock[]);
}

function clickImage(index = 0) {
  const imgs = container.querySelectorAll("img");
  expect(imgs.length).toBeGreaterThan(index);
  act(() => {
    imgs[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("message image click opens the lightbox", () => {
  it("opens the lightbox when the user message has no reply yet", () => {
    const user = makeMessage();
    renderCard(user, [user]);
    clickImage();
    expect(useAppStore.getState().lightboxImages).toHaveLength(1);
  });

  it("opens the lightbox in history where the turn has an assistant reply", () => {
    const user = makeMessage();
    const assistant = makeMessage({
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
    renderCard(user, [user, assistant]);
    clickImage();
    expect(useAppStore.getState().lightboxImages).toHaveLength(1);
  });

  it("opens the lightbox when ChatView passes the assistant-only turn lookup", () => {
    const user = makeMessage();
    const assistant = makeMessage({
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
    renderCard(user, [user, assistant], true);
    clickImage();
    const state = useAppStore.getState();
    expect(state.lightboxImages).toHaveLength(1);
    expect(state.lightboxSource).toBe("message");
  });

  it("opens the lightbox at the clicked image when the message has several", () => {
    const user = makeMessage({
      content: [
        { type: "text", text: "two shots" },
        IMAGE_BLOCK,
        SECOND_IMAGE_BLOCK,
      ],
    });
    const assistant = makeMessage({
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
    renderCard(user, [user, assistant], true);
    clickImage(1);
    const state = useAppStore.getState();
    expect(state.lightboxImages).toHaveLength(2);
    expect(state.lightboxIndex).toBe(1);
  });

  it("keeps the turn lookup for assistant messages so turn images stay in one list", () => {
    const first = makeMessage({
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "shot one" }, IMAGE_BLOCK],
    });
    const sibling = makeMessage({
      id: "a2",
      role: "assistant",
      content: [{ type: "text", text: "shot two" }, SECOND_IMAGE_BLOCK],
    });
    renderCard(first, [first, sibling], true);
    clickImage();
    const state = useAppStore.getState();
    expect(state.lightboxImages).toHaveLength(2);
    expect(state.lightboxIndex).toBe(0);
  });
});
