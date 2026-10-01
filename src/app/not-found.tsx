import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-20 text-center">
      <p className="eyebrow mb-3">404</p>
      <h1 className="font-serif text-3xl">That page isn&apos;t here</h1>
      <p className="mt-3 text-graphite">It may have moved, or the link was wrong.</p>
      <div className="mt-6 flex justify-center">
        <ButtonLink href="/app">Go to the overview</ButtonLink>
      </div>
    </main>
  );
}
