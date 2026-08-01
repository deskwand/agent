import { describe, expect, it } from "vitest";
import { reduceUiRequest } from "../../renderer/components/ExtensionDialogs";

describe("reduceUiRequest", () => {
  it("maps confirm request to dialog state", () => {
    const state = reduceUiRequest({
      type: "extension_ui_request",
      id: "1",
      method: "confirm",
      title: "Sure?",
      message: "Go?",
    });
    expect(state).toEqual({
      id: "1",
      kind: "confirm",
      title: "Sure?",
      message: "Go?",
    });
  });

  it("maps select request with options", () => {
    const state = reduceUiRequest({
      type: "extension_ui_request",
      id: "2",
      method: "select",
      title: "Pick",
      options: ["A", "B"],
    });
    expect(state).toEqual({ id: "2", kind: "select", title: "Pick", options: ["A", "B"] });
  });

  it("maps editor request with prefill", () => {
    const state = reduceUiRequest({
      type: "extension_ui_request",
      id: "3",
      method: "editor",
      title: "Edit",
      prefill: "hello",
    });
    expect(state).toEqual({ id: "3", kind: "editor", title: "Edit", prefill: "hello" });
  });
});
