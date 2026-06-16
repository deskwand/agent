import type { ClientEvent } from "../renderer/types";

export function eventRequiresSessionManager(event: ClientEvent): boolean {
  switch (event.type) {
    case "session.start":
    case "session.continue":
    case "session.setThinkingLevel":
    case "session.setProviderModel":
    case "session.stop":
    case "session.compact":
    case "session.abortCompaction":
    case "session.delete":
    case "session.batchDelete":
    case "project.delete":
    case "session.list":
    case "session.getMessages":
    case "session.getTraceSteps":
    case "permission.response":
      return true;
    default:
      return false;
  }
}
