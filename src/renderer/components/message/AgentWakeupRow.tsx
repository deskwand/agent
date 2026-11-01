import { AlarmClock } from "lucide-react";

/** 常驻智能体的自动唤醒消息：系统样式的条目，不是用户气泡，也不带用户消息的操作。 */
export function AgentWakeupRow({ body }: { body: string }) {
  return (
    <div
      data-agent-wakeup
      className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <AlarmClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        {body.split("\n").map((line, index) => (
          <div key={index} className="break-words">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
