import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Ban, Loader2 } from "lucide-react";
import { Logo } from "@/components/linkr/Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/banned")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Account banned - Linkr" },
      { name: "description", content: "This X account cannot access Linkr." },
    ],
  }),
  component: BannedPage,
});

function BannedPage() {
  const [seconds, setSeconds] = useState(5);
  const handle = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("handle") ?? "";
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.signOut().catch(() => undefined);

    const tick = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    const timeout = window.setTimeout(() => {
      if (!cancelled) window.location.replace("/");
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(timeout);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-5 py-6 text-[#0a0d0b]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Logo to="/" />
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </header>

      <section className="mx-auto mt-24 flex max-w-xl flex-col items-center rounded-lg border border-[#d9decf] bg-white px-8 py-10 text-center shadow-sm">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#ffeded] text-[#b42318]">
          <Ban aria-hidden="true" size={28} strokeWidth={2.4} />
        </span>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#66706b]">
          Access blocked
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">This X account is banned.</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-[#4d5a53]">
          {handle
            ? `@${handle} cannot use Linkr or receive Linkr bot responses.`
            : "This X account cannot use Linkr or receive Linkr bot responses."}
        </p>
        <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-[#d9decf] px-4 py-2 text-sm font-semibold text-[#0a0d0b]">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Redirecting home in {seconds}s
        </div>
      </section>
    </main>
  );
}
