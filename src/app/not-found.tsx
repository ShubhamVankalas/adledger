import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <h1 className="text-5xl font-semibold tracking-tight">404</h1>
        <p className="mt-2 text-muted-foreground">This page doesn&apos;t exist.</p>
      </div>
      <Button render={<Link href="/" />}>Back to dashboard</Button>
    </main>
  );
}
