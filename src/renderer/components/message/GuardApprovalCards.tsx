// Pinned approval cards for guarded tool calls (ids prefixed `guard:`). They sit above the
// composer instead of inside tool blocks, which may be collapsed or replaced by codemode children.
import { useMemo } from "react";
import { useAppStore } from "../../store";
import type { ToolUseContent } from "../../types";
import { AskUserCard } from "./AskUserCard";

export const GUARD_CARD_PREFIX = "guard:";

export function GuardApprovalCards({
  sessionId,
  className,
}: {
  sessionId: string | null;
  className?: string;
}) {
  const pendingAskUsers = useAppStore((s) => s.pendingAskUsers);
  const blocks = useMemo(
    () =>
      Object.values(pendingAskUsers)
        .filter(
          (r) =>
            r.sessionId === sessionId &&
            r.toolCallId.startsWith(GUARD_CARD_PREFIX),
        )
        .map(
          (r): ToolUseContent => ({
            type: "tool_use",
            id: r.toolCallId,
            name: "ask_user",
            input: { questions: r.questions },
          }),
        ),
    [pendingAskUsers, sessionId],
  );
  if (blocks.length === 0) return null;
  return (
    <div className={className}>
      {blocks.map((block) => (
        <AskUserCard
          key={block.id}
          block={block}
          allBlocks={[]}
          allMessages={[]}
        />
      ))}
    </div>
  );
}
