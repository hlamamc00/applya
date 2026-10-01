import { requireUser } from "@/lib/auth";
import { AppNav } from "./app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <AppNav user={{ name: `${user.firstName} ${user.lastName}`, email: user.email, isAdmin: user.role === "ADMIN" }} />
      <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12">{children}</main>
    </div>
  );
}
