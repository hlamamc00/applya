import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  const { next } = await searchParams;
  if (user) redirect(next && next.startsWith("/") ? next : "/app");

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center bg-white px-6 py-12 sm:px-12 lg:px-[10%]">
        <div className="w-full max-w-md">
          <Logo width={200} href="" />
          <p className="eyebrow mt-8">Your next chapter</p>
          <h1 className="mt-3 mb-6 font-serif text-4xl">Welcome back</h1>
          <LoginForm next={next} />
          <p className="mt-8 text-xs text-graphite">Your profile and applications are private to your account.</p>
          <p className="mt-1 text-xs text-graphite">
            <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
          </p>
        </div>
      </div>
      <aside className="hidden flex-col justify-center bg-navy px-[12%] py-[18vh] text-white lg:flex">
        <span className="text-xs font-semibold tracking-[0.3em] text-green">YOUR CAREER, CONSIDERED</span>
        <h2 className="my-10 font-serif text-6xl leading-[1.08] xl:text-7xl">
          Find the fit.
          <br />
          Make it yours.
        </h2>
        <p className="text-lg text-[#b6c9cd]">
          Screen opportunities. Refine your CV.
          <br />
          Approve when you are ready.
        </p>
      </aside>
    </main>
  );
}
