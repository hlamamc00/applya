"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui";

// Shown instead of a blank crash when a page or action fails. The commonest
// cause is a page left open across a deploy: its buttons point at the old
// build, and a reload fixes it.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const stale = /server action|failed to find|could not find the module|chunk/i.test(error.message);
  return (
    <main className="mx-auto max-w-lg px-6 py-20 text-center">
      <p className="eyebrow mb-3">Something went wrong</p>
      <h1 className="font-serif text-3xl">{stale ? "Applya was updated while this page was open" : "That didn't work"}</h1>
      <p className="mt-3 text-graphite">
        {stale ? "Reload the page to pick up the new version; anything you saved is kept." : "Nothing you saved has been lost. Reload the page and try again; if it keeps happening, tell us what you were doing."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button type="button" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button type="button" variant="secondary" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/app" variant="ghost">
          Overview
        </ButtonLink>
      </div>
      {error.digest && <p className="mt-8 text-xs text-steel">Reference {error.digest}</p>}
    </main>
  );
}
