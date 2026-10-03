"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies `text` to the clipboard, with a tick to say it did. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: select-and-copy fallback.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" onClick={copy} aria-label={done ? "Copied" : label} title={label} className={`inline-flex items-center gap-1 rounded-md border border-mist bg-white px-2 py-1 text-xs font-semibold text-graphite hover:bg-cloud ${className}`}>
      {done ? <Check size={14} className="text-green" /> : <Copy size={14} />} {done ? "Copied" : label}
    </button>
  );
}
