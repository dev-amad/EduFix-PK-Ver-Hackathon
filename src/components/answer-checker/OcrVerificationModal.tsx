"use client";

import { ScanTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface OcrVerificationModalProps {
  open: boolean;
  text: string;
  imageUrl: string | null;
  /** BCP-47 tag for the extracted script (Urdu → "ur"); drives the Nastaliq font. */
  lang?: string;
  onOpenChange: (open: boolean) => void;
  onTextChange: (value: string) => void;
  onConfirm: () => void;
}

/**
 * Task 6.2 — OCR verification modal.
 *
 * Shows the uploaded script beside the machine-extracted text so the student can
 * correct any OCR mistakes BEFORE the answer is graded (PRD §4.2/§8.2). The
 * confirmed text becomes the submission; nothing is graded until the student
 * accepts it here.
 */
export function OcrVerificationModal({
  open,
  text,
  imageUrl,
  lang,
  onOpenChange,
  onTextChange,
  onConfirm,
}: OcrVerificationModalProps) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const canConfirm = text.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" lang={lang}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanTextIcon className="size-5 text-emerald-600" aria-hidden />
            Verify extracted text
          </DialogTitle>
          <DialogDescription>
            We read your handwritten answer with OCR. Check the text and fix
            anything before grading — handwriting recognition is not perfect.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Your upload</Label>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="Uploaded handwritten answer script"
                className="max-h-72 w-full rounded-lg border object-contain"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                No preview available
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ocr-text" className="text-xs text-muted-foreground">
              Extracted text (editable)
            </Label>
            <textarea
              id="ocr-text"
              dir="auto"
              rows={12}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="OCR found no text — type or paste the answer here."
              className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {words} {words === 1 ? "word" : "words"}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <ScanTextIcon className="size-4" aria-hidden />
            Use this text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
