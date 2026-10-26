import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../app-button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { OccludingDialog } from "../ui/occluding-dialog";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../../utils/cn";
import type { FeedbackType } from "../../../shared/feedback";
import { codePointLength } from "./feedback-format";

const TYPES: FeedbackType[] = ["bug", "feature", "other"];
const MAX_TITLE = 120;
const MAX_BODY = 4000;

export function FeedbackComposeDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    type: FeedbackType;
    title: string;
    body: string;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) {
      setType("bug");
      setTitle("");
      setBody("");
    }
  }, [open]);

  const titleLength = codePointLength(title.trim());
  const bodyLength = codePointLength(body.trim());
  const canSubmit =
    titleLength > 0 &&
    titleLength <= MAX_TITLE &&
    bodyLength > 0 &&
    bodyLength <= MAX_BODY &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    await onSubmit({ type, title: title.trim(), body: body.trim() });
  };

  return (
    <OccludingDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {t("feedback.compose.title")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("feedback.compose.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-control bg-muted/40 p-0.5">
          {TYPES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={cn(
                "flex-1 rounded-control px-2 py-1.5 text-xs transition-colors",
                type === value
                  ? "bg-selected-surface text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`feedback.type.${value}`)}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            {t("feedback.compose.titleLabel")}
          </span>
          <Input
            value={title}
            placeholder={t("feedback.compose.titlePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            {t("feedback.compose.bodyLabel")}
          </span>
          <Textarea
            value={body}
            placeholder={t("feedback.compose.bodyPlaceholder")}
            className="min-h-[120px]"
            onChange={(event) => setBody(event.target.value)}
          />
          <span className="mt-1 block text-right text-[10px] text-muted-foreground">
            {codePointLength(body)} / {MAX_BODY}
          </span>
        </label>

        <div className="rounded-control border border-warning/20 bg-warning/10 px-3 py-2 text-[11px] leading-5 text-warning">
          {t("feedback.compose.publicNotice")}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("feedback.compose.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {t("feedback.compose.submit")}
          </Button>
        </div>
      </DialogContent>
    </OccludingDialog>
  );
}
