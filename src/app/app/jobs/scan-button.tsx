"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { scanNow } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";
import { LiveStatus } from "@/components/live-status";

export function ScanButton({ running }: { running: { phase: string; startedAt: string } | null }) {
  const [state, action] = useActionState<FormState, FormData>(async () => scanNow(), {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <LiveStatus url="/app/scan-status" active={Boolean(running) || Boolean(state.ok)} label={running ? `Scan running since ${running.startedAt}…` : "Scan starting…"} />
      <SubmitButton variant="secondary" pending="Starting…" disabled={Boolean(running)}>
        <RefreshCw size={15} /> Scan now
      </SubmitButton>
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.error && <Notice tone="red">{state.error}</Notice>}
    </form>
  );
}
