"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * A spinner for work going on in the background. Polls `url` (JSON
 * `{ busy, label }`) while `active`; when the work finishes the page is
 * refreshed so the outcome appears without anyone pressing reload.
 */
export function LiveStatus({ url, active, label, intervalMs = 4000, className = "" }: { url: string; active: boolean; label: string; intervalMs?: number; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<boolean | null>(null);
  const [text, setText] = useState(label);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const data = (await res.json()) as { busy: boolean; label?: string };
        if (stopped) return;
        if (data.label) setText(data.label);
        if (!data.busy) {
          setBusy(false);
          router.refresh();
          return;
        }
        setBusy(true);
      } catch {
        // A blip; try again next time round.
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [url, active, intervalMs, router]);

  if (!active || busy === false) return null;
  return (
    <span className={`inline-flex items-center gap-2 text-sm text-graphite ${className}`} role="status" aria-live="polite">
      <Loader2 size={15} className="animate-spin text-ink" /> {text}
    </span>
  );
}
