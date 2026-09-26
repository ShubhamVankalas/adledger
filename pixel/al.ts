// AdLedger pixel. Install with:
//   <script async src="https://YOUR-ADLEDGER/p/al.js" data-site="pk_..."></script>
// Public API (callable before the script loads via the stub in the snippet):
//   adledger.identify({ email, phone, name })   link this browser to a person
//   adledger.lead({ email, phone, name }, "Form name")   record a lead (+ identify)
//   adledger.track("event_name", { any: "props" })
//   adledger.getVisitorId()
//   adledger.consent(false)   stop tracking and clear the visitor ID
//   adledger.whatsapp("919876543210", "Hi!")   open a WhatsApp chat tagged "Ref: AL-XXXXX"
// Clicks on wa.me / api.whatsapp.com / whatsapp:// links are tagged the same way and sent as
// "whatsapp_click" (opt out per link with data-adledger-noref); tel: links send "call_click".

type Traits = { email?: string; phone?: string; name?: string };
type Ev = { t: "page_view" | "identify" | "lead" | "custom"; ts: number; url: string; ref?: string | null; name?: string; props?: Record<string, unknown>; traits?: Traits };
type QueueItem = [string, ...unknown[]];

(function () {
  const w = window as unknown as { adledger?: { q?: QueueItem[]; _loaded?: boolean } & Record<string, unknown> };
  if (w.adledger && w.adledger._loaded) return;
  const d = document;
  const script = (d.currentScript || d.querySelector("script[data-site]")) as HTMLScriptElement | null;
  if (!script) return;
  const site = script.getAttribute("data-site") || "";
  const endpoint = script.getAttribute("data-endpoint") || new URL(script.src).origin + "/api/v1/collect";
  const respectDnt = script.getAttribute("data-dnt") === "true";
  const COOKIE = "_al_vid";
  const CONSENT = "_al_consent";
  const YEAR2 = 63072000;

  const store = {
    get(k: string): string | null {
      const m = d.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)"));
      if (m) return decodeURIComponent(m[1]);
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k: string, v: string) {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      d.cookie = k + "=" + encodeURIComponent(v) + "; Max-Age=" + YEAR2 + "; Path=/; SameSite=Lax" + secure + rootDomain();
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked */
      }
    },
    del(k: string) {
      d.cookie = k + "=; Max-Age=0; Path=/" + rootDomain();
      try {
        localStorage.removeItem(k);
      } catch {
        /* storage blocked */
      }
    },
  };

  // Share the visitor ID across subdomains: use the broadest domain that accepts a cookie
  // (www.shop.example.co.uk -> .example.co.uk), like other analytics tools do.
  let domainAttr: string | null = null;
  function rootDomain(): string {
    if (domainAttr !== null) return domainAttr;
    domainAttr = "";
    const parts = location.hostname.split(".");
    if (/^[\d.]+$/.test(location.hostname) || parts.length < 2) return domainAttr;
    for (let i = parts.length - 2; i >= 0; i--) {
      const cand = "; Domain=." + parts.slice(i).join(".");
      d.cookie = "_al_t=1; Path=/" + cand;
      if (d.cookie.indexOf("_al_t=1") >= 0) {
        d.cookie = "_al_t=; Max-Age=0; Path=/" + cand;
        return (domainAttr = cand);
      }
    }
    return domainAttr;
  }

  function uuid(): string {
    const c = w as unknown as { crypto?: Crypto };
    if (c.crypto && c.crypto.randomUUID) return c.crypto.randomUUID().replace(/-/g, "");
    let s = "";
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  const dnt = respectDnt && (navigator.doNotTrack === "1" || (w as unknown as { doNotTrack?: string }).doNotTrack === "1");
  let enabled = !dnt && store.get(CONSENT) !== "0";
  let vid = store.get(COOKIE);
  if (enabled && !vid) {
    vid = uuid();
    store.set(COOKIE, vid);
  }

  let queue: Ev[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function payload(events: Ev[]) {
    return JSON.stringify({ site, vid, fbp: store.get("_fbp"), fbc: store.get("_fbc"), events });
  }

  function send(events: Ev[], retry: boolean) {
    const body = payload(events);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))) return;
    } catch {
      /* fall through */
    }
    fetch(endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" }, mode: "no-cors" }).catch(() => {
      if (retry) setTimeout(() => send(events, false), 2000);
    });
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.length || !enabled || !vid) return;
    const batch = queue.splice(0, 50);
    send(batch, true);
    if (queue.length) flush();
  }

  function push(e: Omit<Ev, "ts" | "url">, now?: boolean) {
    if (!enabled) return;
    queue.push({ ts: Date.now(), url: location.href, ...e } as Ev);
    if (now) flush();
    else if (!timer) timer = setTimeout(flush, 1000);
  }

  function clean(t: Traits | undefined): Traits {
    const out: Traits = {};
    if (t && typeof t === "object") {
      if (t.email) out.email = String(t.email).trim();
      if (t.phone) out.phone = String(t.phone).trim();
      if (t.name) out.name = String(t.name).trim();
    }
    return out;
  }

  let lastUrl = "";
  function pageView() {
    if (location.href === lastUrl) return;
    const ref = lastUrl || d.referrer || null;
    lastUrl = location.href;
    push({ t: "page_view", ref });
  }

  // WhatsApp click-to-chat: append a reference code to the prefilled text and record it, so the
  // WhatsApp Business webhook can match the conversation to this visitor. Alphabet has no 0/O/1/I
  // (must match src/lib/connectors/leads-whatsapp.ts).
  const WA = /^(https?:\/\/(wa\.me|api\.whatsapp\.com|(web\.)?whatsapp\.com\/send)|whatsapp:)/i;
  function waTag(href: string, ref: boolean): string {
    if (!enabled || !vid) return href;
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      return href;
    }
    const to = (u.searchParams.get("phone") || u.pathname).replace(/\D/g, "");
    let code: string | undefined;
    if (ref) {
      code = "AL-";
      for (let i = 0; i < 5; i++) code += "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)];
      const text = (u.searchParams.get("text") || "").replace(/\s*Ref: AL-\w{5}$/, "");
      u.searchParams.set("text", (text ? text + "\n\n" : "") + "Ref: " + code);
      // URLSearchParams writes spaces as "+"; WhatsApp expects %20 (a literal "+" is already %2B).
      u.search = u.search.replace(/\+/g, "%20");
    }
    push({ t: "custom", name: "whatsapp_click", props: { to, ref: code } }, true);
    return u.href;
  }

  const api = {
    _loaded: true,
    whatsapp(number: string, message?: string) {
      const url = waTag("https://wa.me/" + String(number).replace(/\D/g, "") + (message ? "?text=" + encodeURIComponent(message) : ""), true);
      if (!window.open(url, "_blank")) location.href = url;
      return url;
    },
    identify(traits: Traits) {
      push({ t: "identify", traits: clean(traits) }, true);
    },
    lead(traits: Traits, form?: string) {
      push({ t: "lead", traits: clean(traits), name: form ? String(form).slice(0, 200) : undefined }, true);
    },
    track(name: string, props?: Record<string, unknown>) {
      push({ t: "custom", name: String(name).slice(0, 200), props: props || {} });
    },
    getVisitorId() {
      return vid;
    },
    consent(granted: boolean) {
      enabled = !!granted;
      if (granted) {
        store.del(CONSENT);
        if (!vid) {
          vid = uuid();
          store.set(COOKIE, vid);
        }
        pageView();
      } else {
        store.set(CONSENT, "0");
        store.del(COOKIE);
        vid = null;
        queue = [];
      }
    },
  };

  const pending = (w.adledger && w.adledger.q) || [];
  w.adledger = api as unknown as typeof w.adledger;

  // SPA support.
  const h = history;
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = h[m];
    h[m] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const r = orig.apply(this, args);
      setTimeout(pageView, 0);
      return r;
    } as History[typeof m];
  }
  addEventListener("popstate", () => setTimeout(pageView, 0));
  addEventListener("pagehide", flush);
  d.addEventListener("visibilitychange", () => d.visibilityState === "hidden" && flush());

  pageView();
  for (const [method, ...args] of pending) {
    const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    if (typeof fn === "function") fn(...args);
  }

  // Auto-capture: WhatsApp and phone links (capture phase, before the browser navigates).
  d.addEventListener(
    "click",
    (e) => {
      const t = e.target as Element | null;
      const a = t && t.closest ? (t.closest("a[href]") as HTMLAnchorElement | null) : null;
      if (!a) return;
      if (/^tel:/i.test(a.href)) push({ t: "custom", name: "call_click", props: { to: decodeURIComponent(a.href.slice(4)).replace(/[^\d+]/g, "") } }, true);
      else if (WA.test(a.href)) a.href = waTag(a.href, !a.hasAttribute("data-adledger-noref"));
    },
    true,
  );

  // Auto-capture: forms with data-adledger-lead send a lead on submit.
  d.addEventListener(
    "submit",
    (e) => {
      const f = e.target as HTMLFormElement;
      if (!f || !f.hasAttribute || !f.hasAttribute("data-adledger-lead")) return;
      const data = new FormData(f);
      const get = (re: RegExp) => {
        for (const [k, v] of data.entries()) if (re.test(k) && typeof v === "string" && v) return v;
        return undefined;
      };
      api.lead({ email: get(/e-?mail/i), phone: get(/phone|mobile|tel/i), name: get(/^(full_?)?name$/i) }, f.getAttribute("data-adledger-lead") || f.name || undefined);
    },
    true,
  );
})();
