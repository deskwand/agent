import type {
  Mention,
  UnifiedMessage,
} from "./contracts";

export type PlatformMessageInput = Omit<
  UnifiedMessage,
  "mentions" | "text" | "botMentioned"
> & {
  text: string;
  mentions: Mention[];
  botUserId?: string;
};

export function normalizeMessage(input: PlatformMessageInput): UnifiedMessage {
  const botMention = input.botUserId
    ? input.mentions.find(
        (mention) => mention.isBot && mention.userId === input.botUserId,
      )
    : undefined;
  const botMentioned = botMention !== undefined;
  const mentions = input.mentions.filter(
    (mention) => mention !== botMention,
  );

  return {
    ...input,
    text: removeBotMention(input.text, botMention),
    mentions,
    botMentioned,
  };
}

function removeBotMention(text: string, mention: Mention | undefined): string {
  if (!mention?.displayName) return text.trim();
  const escapedName = mention.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`@${escapedName}\\b\\s*`, "i"), "").trim();
}
