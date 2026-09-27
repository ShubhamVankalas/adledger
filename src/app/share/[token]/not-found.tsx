import { Link2OffIcon } from "lucide-react";

export const metadata = { title: "Link not found", robots: { index: false, follow: false } };

/** Unknown, expired and revoked share links all look the same, so a link's history isn't revealed. */
export default function ShareNotFound() {
  return (
    <main id="main" className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-fill text-muted-foreground">
          <Link2OffIcon aria-hidden className="size-5" />
        </span>
        <h1 className="mt-4 text-title-sm">This link isn’t available</h1>
        <p className="mt-1.5 text-body text-pretty text-muted-foreground">It may have expired or been turned off by the person who shared it. Ask them for a new link.</p>
      </div>
    </main>
  );
}
