import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n";
import { CheckIcon, CopyIcon } from "./icons";

/** Copies `text`; the icon crossfades (with a little blur) to a check, and a live region announces it. */
export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard blocked: leave the button as it was
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button type="button" className={`copy-btn press ${className}`} onClick={copy} aria-label={label} data-copied={copied}>
      <span className="copy-icon copy-icon--copy">
        <CopyIcon />
      </span>
      <span className="copy-icon copy-icon--check">
        <CheckIcon />
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? t.ui.copied : ""}
      </span>
    </button>
  );
}
