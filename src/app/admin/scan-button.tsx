"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { adminScan } from "@/lib/actions/admin";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";
import { LiveStatus } from "@/components/live-status";

export function AdminScanButton() {
  const [state, action] = useActionState<FormState, FormData>(async () => adminScan(), {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <LiveStatus url="/app/scan-status" active={Boolean(state.ok)} label="Scan starting…" />
      <SubmitButton variant="secondary" pending="Starting…">
        <RefreshCw size={15} /> Scan all sources now
      </SubmitButton>
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.error && <Notice tone="red">{state.error}</Notice>}
    </form>
  );
}
