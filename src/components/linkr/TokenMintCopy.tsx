import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/linkr/format";

export function TokenMintCopy({ className, mint }: { className?: string; mint?: string | null }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  if (!mint) return null;

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!mint) return;

    await writeClipboard(mint);
    setCopied(true);

    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <span className={cn("sm-token-mint-copy", className)} title={mint}>
      <code>{shortAddress(mint, 5, 5)}</code>
      <button
        aria-label={copied ? "Token mint copied" : "Copy token mint"}
        data-copied={copied || undefined}
        onClick={handleCopy}
        type="button"
      >
        {copied ? (
          <Check aria-hidden="true" size={14} strokeWidth={2.8} />
        ) : (
          <Copy aria-hidden="true" size={14} strokeWidth={2.4} />
        )}
      </button>
    </span>
  );
}

async function writeClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") return;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
