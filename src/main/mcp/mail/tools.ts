/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * [DeskWand] 相对 vendor 删掉了两个工具：
 *  - `emails_modify`（标记已读/星标/移动）—— 属于「文件夹管理」，不在本轮范围。
 *    而且「Agent 替你标已读」默认不该发生：你没读过的邮件不该因为让 Agent 总结了一下就变成已读。
 *  - `folders_list` —— 它的用途是文件夹管理的配套，管理砍掉后它失去存在理由。
 * 工具名一旦发布不可改（AGENTS.md §5，提示词缓存），所以这次就是最终名单。
 */

/**
 * Email MCP Tools - Clean, simple, and flexible
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const EMAIL_TOOLS: Record<string, Tool> = {
  accounts_list: {
    name: "accounts_list",
    description:
      "List every configured email account and show which account is the default. Use this before other tools when multiple SMTP/IMAP accounts are configured.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  /**
   * Search for emails and optionally get their full content
   */
  emails_find: {
    name: "emails_find",
    description:
      "Search for emails in your inbox with flexible filters. Optionally get full email content and attachments. Use this to find specific emails, check for unread messages, or browse your inbox.",
    inputSchema: {
      type: "object",
      properties: {
        account_name: {
          type: "string",
          description:
            "Name of the email account to use (e.g., 'work', 'personal'). If not provided, uses the default account.",
        },
        query: {
          type: "string",
          description:
            "Text to search across subject, body, sender, and recipients (e.g., 'project update')",
        },
        filters: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Filter by sender email address",
            },
            to: {
              type: "string",
              description: "Filter by recipient email address",
            },
            subject: {
              type: "string",
              description: "Filter by subject line text",
            },
            has_attachments: {
              type: "boolean",
              description: "Filter emails with attachments",
            },
            is_unread: {
              type: "boolean",
              description: "Filter unread (true) or read (false) emails",
            },
            is_flagged: {
              type: "boolean",
              description: "Filter flagged/starred emails",
            },
            after_date: {
              type: "string",
              description:
                "Filter emails after this date (ISO format: YYYY-MM-DD)",
            },
            before_date: {
              type: "string",
              description:
                "Filter emails before this date (ISO format: YYYY-MM-DD)",
            },
          },
          description: "Structured filters for precise email search",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of emails to return (1-100)",
        },
        include_content: {
          type: "boolean",
          default: false,
          description: "Include full email body content in results",
        },
        include_attachments: {
          type: "boolean",
          default: false,
          description:
            "Include attachment metadata (filename, size, content type). No index is returned and attachment bodies are never returned — pass a filename to emails_save_attachment to fetch one.",
        },
      },
    },
  },

  /**
   * Send a new email
   */
  email_send: {
    name: "email_send",
    description:
      "Send a new email with HTML support and file attachments. Use this to send messages, project updates, or any new email conversation.",
    inputSchema: {
      type: "object",
      properties: {
        account_name: {
          type: "string",
          description: "Name of the email account to use",
        },
        to: {
          type: "array",
          items: { type: "string" },
          description: "Array of recipient email addresses",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body content (can be plain text or HTML)",
        },
        body_type: {
          type: "string",
          enum: ["plain", "html"],
          default: "html",
          description:
            "Body format: 'plain' for plain text or 'html' for HTML content",
        },
        from_email: {
          type: "string",
          description:
            "Optional sender address. When sender_emails is configured for the account, the address must be in that allowlist.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Array of CC recipient email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "Array of BCC recipient email addresses",
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string", description: "Name of the file" },
              content: {
                type: "string",
                description: "Base64 encoded file content",
              },
              content_type: {
                type: "string",
                description: "MIME type (e.g., 'application/pdf', 'image/png')",
              },
            },
            required: ["filename", "content"],
          },
          description: "Array of file attachments",
        },
      },
      required: ["to", "subject", "body"],
    },
  },

  /**
   * Reply to or forward an email
   */
  email_respond: {
    name: "email_respond",
    description:
      "Reply to or forward an existing email. Use this to continue email conversations, respond to messages, or forward information to others.",
    inputSchema: {
      type: "object",
      properties: {
        account_name: {
          type: "string",
          description: "Name of the email account to use",
        },
        email_id: {
          type: "string",
          description:
            "ID of the email to respond to (from emails_find results)",
        },
        response_type: {
          type: "string",
          enum: ["reply", "reply_all", "forward"],
          default: "reply",
          description:
            "'reply' to sender only, 'reply_all' to all recipients, or 'forward' to new recipients",
        },
        body: {
          type: "string",
          description: "Your response message content",
        },
        body_type: {
          type: "string",
          enum: ["plain", "html"],
          default: "html",
          description: "Response body format",
        },
        to: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of recipient emails (required for 'forward', optional for replies to override default recipients)",
        },
        include_original: {
          type: "boolean",
          default: true,
          description: "Include the original email content in your response",
        },
        include_attachments: {
          type: "boolean",
          default: true,
          description: "Include attachments from the original email",
        },
        additional_attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string" },
              content: { type: "string", description: "Base64 encoded" },
              content_type: { type: "string" },
            },
            required: ["filename", "content"],
          },
          description: "Additional attachments to include",
        },
      },
      required: ["email_id", "body"],
    },
  },

  /**
   * Save one attachment to disk (the only way to get an attachment body)
   */
  emails_save_attachment: {
    name: "emails_save_attachment",
    description:
      "Save one attachment from an email to a local file and return its absolute path. Use this instead of fetching attachment content into the conversation — attachment bodies are never returned inline.",
    inputSchema: {
      type: "object",
      properties: {
        account_name: {
          type: "string",
          description: "Name of the email account to use",
        },
        email_id: {
          type: "string",
          description: "Email UID from emails_find results",
        },
        index: {
          type: "number",
          description:
            "Zero-based index into this message's parsed attachment array. Prefer `filename`; use this only when two attachments share a name.",
        },
        filename: {
          type: "string",
          description:
            "Attachment filename, used when index is omitted",
        },
        directory: {
          type: "string",
          description:
            "Optional relative subdirectory under the attachment root. Absolute paths and `..` are rejected.",
        },
      },
      required: ["email_id"],
    },
  },
};
