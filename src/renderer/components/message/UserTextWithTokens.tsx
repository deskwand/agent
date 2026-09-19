// 用户气泡里的行内引用：行首的技能/命令 token + 任意位置的文件提及 token。
//
// 助手正文不经过这里 —— 它继续走 MessageMarkdown 的渲染路径（见设计文档 §2「不做」）。
import { useAppStore } from "../../store";
import { splitTextByFileMentions } from "../../utils/file-link";
import { resolveLeadingToken } from "../../utils/reference-tokens";
import { ReferenceToken } from "../ReferenceToken";

export interface UserTextWithTokensProps {
  text: string;
  /** 把原文路径解析成可读的完整路径，仅用于 tooltip */
  resolveFilePath: (value: string) => string;
  onFileClick: (value: string) => void;
}

export function UserTextWithTokens({
  text,
  resolveFilePath,
  onFileClick,
}: UserTextWithTokensProps) {
  const commandLabels = useAppStore((s) => s.commandLabels);
  const token = resolveLeadingToken(text, commandLabels);
  const rest = token ? text.slice(token.raw.length) : text;
  const parts = splitTextByFileMentions(rest);

  return (
    <>
      {token ? (
        <ReferenceToken
          kind={token.kind}
          label={token.label}
          tooltip={token.kind === "command" ? token.raw : undefined}
        />
      ) : null}
      {parts.map((part, index) =>
        part.type === "file" ? (
          <ReferenceToken
            key={`file-${index}`}
            kind="file"
            label={part.value}
            tooltip={resolveFilePath(part.value)}
            onClick={() => onFileClick(part.value)}
          />
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </>
  );
}
