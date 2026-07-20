import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Folder,
  FolderOpen,
  MessageSquare,
  MessageSquareText,
} from "lucide-react";

const SECTION_DURATION_MS = 220;
const ICON_DURATION_MS = 120;
const SECTION_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface SidebarAnimatedSectionProps {
  expanded: boolean;
  motionVersion: number;
  children: ReactNode;
}

interface SidebarGroupIconProps {
  expanded: boolean;
  motionVersion: number;
  kind: "sessions" | "project";
  showRunningBadge?: boolean;
}

function isReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export function SidebarAnimatedSection({
  expanded,
  motionVersion,
  children,
}: SidebarAnimatedSectionProps) {
  const [rendered, setRendered] = useState(expanded);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const heightAnimationRef = useRef<Animation | null>(null);
  const contentAnimationRef = useRef<Animation | null>(null);
  const previousMotionVersionRef = useRef(motionVersion);
  const previousExpandedRef = useRef(expanded);
  const stableHeightRef = useRef(0);
  const pendingOpenRef = useRef(false);

  useLayoutEffect(() => {
    return () => {
      pendingOpenRef.current = false;
      heightAnimationRef.current?.cancel();
      contentAnimationRef.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper) return;

    const cancelAnimations = () => {
      const heightAnimation = heightAnimationRef.current;
      const contentAnimation = contentAnimationRef.current;
      heightAnimationRef.current = null;
      contentAnimationRef.current = null;
      heightAnimation?.cancel();
      contentAnimation?.cancel();
    };

    const canAnimate =
      typeof wrapper.animate === "function" &&
      typeof window.matchMedia === "function";

    if (pendingOpenRef.current && rendered && content) {
      pendingOpenRef.current = false;
      const targetHeight = content.scrollHeight;
      content.style.opacity = "1";
      content.style.transform = "translateY(0)";
      stableHeightRef.current = targetHeight;

      if (!canAnimate) {
        wrapper.style.height = "";
        return;
      }

      if (isReducedMotion()) {
        wrapper.style.height = "";
        const animation = content.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: ICON_DURATION_MS,
          easing: SECTION_EASING,
        });
        contentAnimationRef.current = animation;
        animation.onfinish = () => {
          if (contentAnimationRef.current !== animation) return;
          contentAnimationRef.current = null;
        };
        return;
      }

      wrapper.style.height = `${targetHeight}px`;
      const heightAnimation = wrapper.animate(
        [{ height: "0px" }, { height: `${targetHeight}px` }],
        { duration: SECTION_DURATION_MS, easing: SECTION_EASING },
      );
      const contentAnimation = content.animate(
        [
          { opacity: 0, transform: "translateY(-4px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: SECTION_DURATION_MS, easing: SECTION_EASING },
      );
      heightAnimationRef.current = heightAnimation;
      contentAnimationRef.current = contentAnimation;
      heightAnimation.onfinish = () => {
        if (heightAnimationRef.current !== heightAnimation) return;
        heightAnimationRef.current = null;
        wrapper.style.height = "";
        stableHeightRef.current = contentRef.current?.scrollHeight ?? 0;
      };
      contentAnimation.onfinish = () => {
        if (contentAnimationRef.current !== contentAnimation) return;
        contentAnimationRef.current = null;
      };
      return;
    }

    const motionChanged = motionVersion !== previousMotionVersionRef.current;
    const expandedChanged = expanded !== previousExpandedRef.current;

    if (!motionChanged && !expandedChanged) {
      if (!rendered) {
        wrapper.style.height = "";
        stableHeightRef.current = 0;
      } else if (expanded && content) {
        const currentHeight = content.scrollHeight;
        if (
          heightAnimationRef.current &&
          currentHeight !== stableHeightRef.current
        ) {
          cancelAnimations();
          wrapper.style.height = "";
          content.style.opacity = "1";
          content.style.transform = "translateY(0)";
          stableHeightRef.current = currentHeight;
        } else if (!heightAnimationRef.current) {
          wrapper.style.height = "";
          content.style.opacity = "1";
          content.style.transform = "translateY(0)";
          stableHeightRef.current = currentHeight;
        }
      }
      return;
    }

    previousMotionVersionRef.current = motionVersion;
    previousExpandedRef.current = expanded;

    if (!motionChanged || !canAnimate) {
      cancelAnimations();
      wrapper.style.height = "";
      stableHeightRef.current = expanded && content ? content.scrollHeight : 0;
      if (content) {
        content.style.opacity = expanded ? "1" : "0";
        content.style.transform = expanded
          ? "translateY(0)"
          : "translateY(-4px)";
      }
      if (rendered !== expanded) setRendered(expanded);
      return;
    }

    if (expanded && !rendered) {
      pendingOpenRef.current = true;
      setRendered(true);
      return;
    }

    if (!content) return;

    const presentationHeight = heightAnimationRef.current
      ? wrapper.getBoundingClientRect().height
      : stableHeightRef.current;
    cancelAnimations();

    if (isReducedMotion()) {
      wrapper.style.height = "";
      stableHeightRef.current = expanded ? content.scrollHeight : 0;
      content.style.opacity = expanded ? "1" : "0";
      content.style.transform = "translateY(0)";
      if (!expandedChanged) return;
      const animation = content.animate(
        [{ opacity: expanded ? 0 : 1 }, { opacity: expanded ? 1 : 0 }],
        { duration: ICON_DURATION_MS, easing: SECTION_EASING },
      );
      contentAnimationRef.current = animation;
      animation.onfinish = () => {
        if (contentAnimationRef.current !== animation) return;
        contentAnimationRef.current = null;
        if (!expanded) setRendered(false);
      };
      return;
    }

    const targetHeight = expanded ? content.scrollHeight : 0;
    wrapper.style.height = `${targetHeight}px`;
    stableHeightRef.current = targetHeight;
    content.style.opacity = expanded ? "1" : "0";
    content.style.transform = expanded ? "translateY(0)" : "translateY(-4px)";

    const heightAnimation = wrapper.animate(
      [{ height: `${presentationHeight}px` }, { height: `${targetHeight}px` }],
      { duration: SECTION_DURATION_MS, easing: SECTION_EASING },
    );
    heightAnimationRef.current = heightAnimation;

    if (expandedChanged) {
      const contentAnimation = content.animate(
        [
          {
            opacity: expanded ? 0 : 1,
            transform: expanded ? "translateY(-4px)" : "translateY(0)",
          },
          {
            opacity: expanded ? 1 : 0,
            transform: expanded ? "translateY(0)" : "translateY(-4px)",
          },
        ],
        { duration: SECTION_DURATION_MS, easing: SECTION_EASING },
      );
      contentAnimationRef.current = contentAnimation;
      contentAnimation.onfinish = () => {
        if (contentAnimationRef.current !== contentAnimation) return;
        contentAnimationRef.current = null;
      };
    }

    heightAnimation.onfinish = () => {
      if (heightAnimationRef.current !== heightAnimation) return;
      heightAnimationRef.current = null;
      if (expanded) {
        wrapper.style.height = "";
        stableHeightRef.current = contentRef.current?.scrollHeight ?? 0;
      } else {
        contentAnimationRef.current?.cancel();
        contentAnimationRef.current = null;
        setRendered(false);
      }
    };
  });

  return (
    <div
      ref={wrapperRef}
      hidden={!rendered}
      aria-hidden={!expanded}
      className="overflow-hidden"
      style={{ pointerEvents: expanded ? undefined : "none" }}
    >
      {rendered && (
        <div
          ref={contentRef}
          style={{
            opacity: expanded ? 1 : 0,
            transform: expanded ? "translateY(0)" : "translateY(-4px)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function SidebarGroupIcon({
  expanded,
  motionVersion,
  kind,
  showRunningBadge = false,
}: SidebarGroupIconProps) {
  const collapsedRef = useRef<SVGSVGElement>(null);
  const expandedRef = useRef<SVGSVGElement>(null);
  const previousExpandedRef = useRef(expanded);
  const previousMotionVersionRef = useRef(motionVersion);

  useLayoutEffect(() => {
    const expandedChanged = expanded !== previousExpandedRef.current;
    const motionChanged = motionVersion !== previousMotionVersionRef.current;
    previousExpandedRef.current = expanded;
    previousMotionVersionRef.current = motionVersion;

    const collapsedIcon = collapsedRef.current;
    const expandedIcon = expandedRef.current;
    if (
      !expandedChanged ||
      !motionChanged ||
      !collapsedIcon ||
      !expandedIcon ||
      typeof collapsedIcon.animate !== "function" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const reducedMotion = isReducedMotion();
    const outgoing = expanded ? collapsedIcon : expandedIcon;
    const incoming = expanded ? expandedIcon : collapsedIcon;
    const outgoingAnimation = outgoing.animate(
      reducedMotion
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(0.92)" },
          ],
      { duration: ICON_DURATION_MS, easing: SECTION_EASING },
    );
    const incomingAnimation = incoming.animate(
      reducedMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "scale(0.92)" },
            { opacity: 1, transform: "scale(1)" },
          ],
      { duration: ICON_DURATION_MS, easing: SECTION_EASING },
    );
    return () => {
      outgoingAnimation.cancel();
      incomingAnimation.cancel();
    };
  }, [expanded, motionVersion]);

  const collapsedStyle = {
    opacity: expanded ? 0 : 1,
    transform: expanded ? "scale(0.92)" : "scale(1)",
  };
  const expandedStyle = {
    opacity: expanded ? 1 : 0,
    transform: expanded ? "scale(1)" : "scale(0.92)",
  };
  const iconClassName = "absolute inset-0 h-3.5 w-3.5";

  return (
    <span
      className="relative h-3.5 w-3.5 flex-shrink-0 overflow-visible"
      aria-hidden="true"
    >
      {kind === "sessions" ? (
        <>
          <MessageSquare
            ref={collapsedRef}
            className={iconClassName}
            style={collapsedStyle}
          />
          <MessageSquareText
            ref={expandedRef}
            className={iconClassName}
            style={expandedStyle}
          />
        </>
      ) : (
        <>
          <Folder
            ref={collapsedRef}
            className={iconClassName}
            style={collapsedStyle}
          />
          <FolderOpen
            ref={expandedRef}
            className={iconClassName}
            style={expandedStyle}
          />
        </>
      )}
      {showRunningBadge && (
        <span
          className="absolute right-[-2px] top-[-2px] h-1.5 w-1.5 rounded-full bg-accent animate-pulse shadow-[0_0_0_2px_var(--color-background-secondary)]"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
