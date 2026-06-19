import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

// Hoisted to module scope to avoid re-creating arrays on every render
const REMARK_PLUGINS = [
  remarkMath,
  [remarkGfm, { singleTilde: false }],
] as const;
// Sanitize user-authored HTML before KaTeX expands math nodes. Running
// rehypeSanitize after rehypeKatex strips the generated KaTeX markup/classes.
const REHYPE_PLUGINS = [
  rehypeSanitize,
  [rehypeKatex, { throwOnError: false, strict: false }],
] as const;

export interface MessageMarkdownProps {
  normalizedText: string;
  isStreaming?: boolean;
  components?: Record<string, unknown>;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  normalizedText,
  isStreaming,
  components,
}: MessageMarkdownProps) {
  return (
    <div className="prose-chat max-w-full text-text-primary">
      <ReactMarkdown
        remarkPlugins={
          REMARK_PLUGINS as unknown as Parameters<
            typeof ReactMarkdown
          >[0]["remarkPlugins"]
        }
        rehypePlugins={
          REHYPE_PLUGINS as unknown as Parameters<
            typeof ReactMarkdown
          >[0]["rehypePlugins"]
        }
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
});
