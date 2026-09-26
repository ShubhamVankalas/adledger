// AdLedger custom pixel for Shopify (Settings → Customer events → Add custom pixel).
// Paste this whole file, then change the two values below.
//
// It sends page views (storefront + checkout) and links the buyer on checkout to
// AdLedger's collector. Revenue itself comes from the Shopify connector in AdLedger
// (orders/paid + refunds/create webhooks), matched by the adledger_vid cart attribute.

const ADLEDGER_URL = "https://adledger.example.com"; // your AdLedger address, no trailing slash
const SITE_KEY = "pk_REPLACE_ME"; // AdLedger → Settings → Tracking

const ENDPOINT = ADLEDGER_URL + "/api/v1/collect";
const VID_KEY = "_al_vid";
const TWO_YEARS = 63072000;

function newId() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

async function safe(fn) {
  try {
    return (await fn()) || null;
  } catch (e) {
    return null;
  }
}

// The pixel runs in a sandbox, so use Shopify's browser APIs. The _al_vid cookie is shared
// with the theme snippet (cart-attribute.liquid) so the order carries the same visitor id.
let vidPromise = null;
function visitorId() {
  if (!vidPromise) {
    vidPromise = (async () => {
      let vid = (await safe(() => browser.cookie.get(VID_KEY))) || (await safe(() => browser.localStorage.getItem(VID_KEY)));
      if (!vid) vid = newId();
      await safe(() => browser.cookie.set(VID_KEY + "=" + vid + "; path=/; max-age=" + TWO_YEARS + "; SameSite=Lax"));
      await safe(() => browser.localStorage.setItem(VID_KEY, vid));
      return vid;
    })();
  }
  return vidPromise;
}

async function send(event, ev) {
  const doc = (event.context && event.context.document) || {};
  const loc = doc.location || {};
  const vid = await visitorId();
  const body = JSON.stringify({
    site: SITE_KEY,
    vid,
    fbp: await safe(() => browser.cookie.get("_fbp")),
    fbc: await safe(() => browser.cookie.get("_fbc")),
    events: [
      Object.assign(
        {
          ts: Date.parse(event.timestamp) || Date.now(),
          url: loc.href || "",
          ref: doc.referrer || null,
        },
        ev,
      ),
    ],
  });
  // text/plain keeps this a "simple" request (no CORS preflight), like the regular pixel.
  fetch(ENDPOINT, { method: "POST", body, keepalive: true, mode: "no-cors", headers: { "Content-Type": "text/plain" } }).catch(() => {});
}

function traitsFrom(checkout) {
  if (!checkout) return {};
  const addr = checkout.billingAddress || checkout.shippingAddress || {};
  const traits = {};
  if (checkout.email) traits.email = checkout.email;
  const phone = checkout.phone || addr.phone;
  if (phone) traits.phone = phone;
  const name = [addr.firstName, addr.lastName].filter(Boolean).join(" ");
  if (name) traits.name = name;
  return traits;
}

analytics.subscribe("page_viewed", (event) => {
  send(event, { t: "page_view" });
});

// Email typed at checkout: link the visitor early (also covers abandoned checkouts).
analytics.subscribe("checkout_contact_info_submitted", (event) => {
  const traits = traitsFrom(event.data && event.data.checkout);
  if (traits.email || traits.phone) send(event, { t: "identify", traits });
});

analytics.subscribe("checkout_completed", (event) => {
  const checkout = (event.data && event.data.checkout) || {};
  const traits = traitsFrom(checkout);
  if (traits.email || traits.phone) send(event, { t: "identify", traits });
  const total = checkout.totalPrice || {};
  send(event, {
    t: "custom",
    name: "checkout_completed",
    props: {
      order_id: checkout.order && checkout.order.id,
      value: total.amount,
      currency: total.currencyCode || checkout.currencyCode,
    },
  });
});
