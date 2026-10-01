"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button } from "./ui";

/** A submit button that shows it's working while the Server Action runs. */
export function SubmitButton({ children, pending, ...props }: ComponentProps<typeof Button> & { pending?: string }) {
  const status = useFormStatus();
  return (
    <Button type="submit" disabled={status.pending} {...props}>
      {status.pending ? (pending ?? "Working…") : children}
    </Button>
  );
}
