# Next.js and React

The pixel handles single-page apps on its own: it records a page view on every client-side
route change (`history.pushState`). You only need to load it once.

## Next.js (App Router)

In `app/layout.tsx`:

```tsx
import Script from "next/script";

const ADLEDGER_URL = "https://YOUR-ADLEDGER"; // no trailing slash
const SITE_KEY = "pk_..."; // AdLedger → Settings → Tracking

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script id="adledger-stub" strategy="beforeInteractive">
          {`window.adledger=window.adledger||{q:[]};["identify","lead","track","consent"].forEach(function(m){adledger[m]=adledger[m]||function(){adledger.q.push([m].concat([].slice.call(arguments)))}});`}
        </Script>
        <Script src={`${ADLEDGER_URL}/p/al.js`} data-site={SITE_KEY} strategy="afterInteractive" />
      </body>
    </html>
  );
}
```

**Pages Router:** put the same two `<Script>` tags in `pages/_app.tsx` (use
`strategy="afterInteractive"` for both, stub first).

## React (Vite, Create React App, etc.)

Paste the snippet from **Settings → Tracking** into the `<head>` of `index.html`.

## Types

Add once, for example in `src/adledger.d.ts`:

```ts
type AdLedgerTraits = { email?: string; phone?: string; name?: string };

interface Window {
  adledger?: {
    lead(traits: AdLedgerTraits, formName?: string): void;
    identify(traits: AdLedgerTraits): void;
    track(name: string, props?: Record<string, unknown>): void;
    consent(granted: boolean): void;
    getVisitorId?(): string | null; // only after al.js has loaded
  };
}
```

## Leads and sign-ups

Call these after your form or sign-up succeeds:

```ts
window.adledger?.lead({ email, name }, "Book a demo");
window.adledger?.identify({ email }); // e.g. after login
```

## Pass the visitor id to Stripe Checkout

This links each payment to the exact ad click, not just the email.

**1. Read the visitor id in the browser.** `getVisitorId()` exists once `al.js` has loaded, so
fall back to the pixel's cookie:

```ts
export function getAdLedgerVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  const fromPixel = window.adledger?.getVisitorId?.();
  if (fromPixel) return fromPixel;
  const m = document.cookie.match(/(?:^|; )_al_vid=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}
```

**2. Send it with your checkout request:**

```ts
const res = await fetch("/api/checkout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan: "pro", vid: getAdLedgerVisitorId() }),
});
const { url } = await res.json();
window.location.href = url;
```

**3. Put it on the Checkout Session** (`app/api/checkout/route.ts`):

```ts
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const PRICES: Record<string, string> = { pro: "price_123" }; // never trust a price id from the browser

export async function POST(req: Request) {
  const { plan, vid } = await req.json();
  const price = PRICES[plan];
  if (!price) return Response.json({ error: "unknown plan" }, { status: 400 });

  const safeVid = typeof vid === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(vid) ? vid : undefined;
  const origin = new URL(req.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription", // or "payment"
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/thanks`,
    cancel_url: `${origin}/pricing`,
    client_reference_id: safeVid,
    metadata: safeVid ? { adledger_vid: safeVid } : undefined,
  });
  return Response.json({ url: session.url });
}
```

AdLedger's Stripe connector reads `client_reference_id` or `metadata.adledger_vid`. Set up the
connector in **Settings → Connections → Stripe** (see [CONNECTORS.md](../CONNECTORS.md)).

Not using Stripe? Send payments from your backend with the
[Conversions API](zapier-make.md#conversions-api) and include `visitor_id`.

## Check it works

1. Open your app in a private window and click through a few pages.
2. AdLedger → **Settings → Tracking** shows a page view for each route within a minute.
3. In the browser console, `adledger.getVisitorId()` returns an id.

## Troubleshooting

- **Only the first page view is recorded:** make sure the script isn't loaded again on each
  route (load it in the root layout only).
- **`getVisitorId` is undefined:** the pixel hasn't loaded yet; use the helper above.
- **Blocked by Content Security Policy:** allow your AdLedger origin in `script-src` and
  `connect-src`.
- **"Allowed domains" is set in AdLedger:** include `localhost` while developing, or use a
  separate site key for development.
