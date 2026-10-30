import { lazy, Suspense, useMemo } from "react";
import { useEnsureSessionHydrated } from "../../hooks/use-ensure-session-hydrated";
import { PanelErrorBoundary } from "../PanelErrorBoundary";
import { WelcomeView } from "../WelcomeView";
import { PaneContext } from "./pane-context";
import { PaneDropZones } from "./PaneDropZones";
import { PaneHeader } from "./PaneHeader";
import { PermissionCard } from "./PermissionCard";
import { SudoPasswordCard } from "./SudoPasswordCard";
import {
  usePendingPermissionsForSession,
  usePendingSudoForSession,
} from "../../store/selectors";
import {
  useFocusedPaneId,
  usePaneCount,
  useSplitLayoutStore,
} from "../../store/split-layout";
import type { PaneId } from "../../store/split-tree";

const ChatView = lazy(() =>
  import("../ChatView").then((module) => ({ default: module.ChatView })),
);

function PaneFallback() {
  return <div className="flex-1 min-h-0 bg-background" />;
}

export function PaneView({
  paneId,
  sessionId,
  showHeader,
}: {
  paneId: PaneId;
  sessionId: string | null;
  showHeader: boolean;
}) {
  useEnsureSessionHydrated(sessionId);
  const focusPane = useSplitLayoutStore((s) => s.focusPane);
  const focused = useFocusedPaneId() === paneId;
  const multiple = usePaneCount() > 1;
  const permissions = usePendingPermissionsForSession(sessionId);
  const sudoRequests = usePendingSudoForSession(sessionId);
  const ctx = useMemo(() => ({ paneId, sessionId }), [paneId, sessionId]);
  const permission = permissions[0];
  const sudo = sudoRequests[0];

  return (
    <PaneContext.Provider value={ctx}>
      <div
        data-pane-id={paneId}
        onPointerDownCapture={() => focusPane(paneId)}
        className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          focused && multiple ? "ring-1 ring-primary/40" : ""
        }`}
      >
        <PaneDropZones paneId={paneId}>
          {showHeader && <PaneHeader paneId={paneId} sessionId={sessionId} />}
          <PanelErrorBoundary
            name="PaneView"
            resetKey={sessionId ?? paneId}
            fallback={<PaneFallback />}
          >
            {sessionId === null ? (
              <WelcomeView />
            ) : (
              <Suspense fallback={<PaneFallback />}>
                <ChatView />
              </Suspense>
            )}
          </PanelErrorBoundary>
          {(permission || sudo) && (
            // 卡片放在聊天区（含输入框）下方、正常文档流里，不遮挡输入框；
            // 限高 + 内部滚动，避免挤掉消息区。
            <div className="max-h-[60%] shrink-0 overflow-y-auto border-t border-border bg-card p-4">
              {permission && (
                <PermissionCard
                  key={permission.toolUseId}
                  permission={permission}
                  extraCount={permissions.length - 1}
                />
              )}
              {sudo && (
                <div className={permission ? "mt-4" : undefined}>
                  <SudoPasswordCard
                    key={sudo.toolUseId}
                    request={sudo}
                    extraCount={sudoRequests.length - 1}
                  />
                </div>
              )}
            </div>
          )}
        </PaneDropZones>
      </div>
    </PaneContext.Provider>
  );
}
