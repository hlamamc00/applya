"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { adminScan } from "@/lib/actions/admin";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";

export function AdminScanButton() {
  const [state, action] = useActionState<FormState, FormData>(async () => adminScan(), {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <SubmitButton variant="secondary" pending="Scanning all sources…">
        <RefreshCw size={15} /> Scan all sources now
      </SubmitButton>
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.error && <Notice tone="red">{state.error}</Notice>}
    </form>
  );
}
