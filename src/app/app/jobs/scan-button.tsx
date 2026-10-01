"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { scanNow } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui";

export function ScanButton() {
  const [state, action] = useActionState<FormState, FormData>(async () => scanNow(), {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <SubmitButton variant="secondary" pending="Scanning… this can take a minute">
        <RefreshCw size={15} /> Scan now
      </SubmitButton>
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      {state.error && <Notice tone="red">{state.error}</Notice>}
    </form>
  );
}
