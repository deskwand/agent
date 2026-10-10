// AskUserQuestion tool block — read-only display for historical messages
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import type { ToolUseContent, QuestionItem } from "../../types";

interface AskUserQuestionBlockProps {
  block: ToolUseContent;
}

export function AskUserQuestionBlock({ block }: AskUserQuestionBlockProps) {
  const { t } = useTranslation();
  const questions: QuestionItem[] =
    ((block.input as Record<string, unknown>)?.questions as QuestionItem[]) ||
    [];

  const getOptionLetter = (index: number) => String.fromCharCode(65 + index);

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <span className="text-muted-foreground">{t("messageCard.noQuestions")}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-primary/10 border-b border-primary/20 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <HelpCircle className="w-4 h-4 text-primary-text" />
        </div>
        <div>
          <span className="font-medium text-sm text-foreground">
            {t("messageCard.question")}
          </span>
        </div>
      </div>

      {/* Questions (read-only) */}
      <div className="p-4 space-y-5">
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="space-y-2">
            {q.header && (
              <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary-text text-xs font-semibold rounded uppercase tracking-wide">
                {q.header}
              </span>
            )}
            <p className="text-foreground font-medium text-sm">
              {q.question}
            </p>
            {q.options && q.options.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {q.options.map((option, optIdx) => (
                  <div
                    key={optIdx}
                    className="w-full p-3 rounded-lg border border-border/40 bg-muted text-left"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold bg-border/40 text-muted-foreground">
                        {getOptionLetter(optIdx)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-foreground">
                          {option.label}
                        </span>
                        {option.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
