import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIMPLE_ICONS } from "@/components/brand-icons.data";
import { EXTRA_ADS_CONNECTORS } from "@/lib/connectors/ads/index";

// The static website (site/index.html) is deployed on its own by .github/workflows/pages.yml,
// which copies docs/screenshots to site/screenshots. These checks keep it in sync with the app.

const html = readFileSync("site/index.html", "utf8");

describe("landing page", () => {
  it("references only screenshots that exist in docs/screenshots", () => {
    const shots = new Set([...html.matchAll(/screenshots\/([\w-]+)\.png/g)].map((m) => m[1]));
    for (const m of html.matchAll(/data-shot="([\w-]+)"/g)) shots.add(m[1]);
    expect(shots.size).toBeGreaterThan(5);
    for (const name of shots) expect(existsSync(`docs/screenshots/${name}.png`), name).toBe(true);
  });

  it("gives every product-story chapter a note, a fallback screenshot and a 3D key", () => {
    const list = html.slice(html.indexOf('<ol class="chapters">'), html.indexOf("</ol>", html.indexOf('<ol class="chapters">')));
    const chapters = list.split('<li class="chapter').slice(1);
    const modules = chapters.filter((c) => !/^ chapter-(head|end)"/.test(c));
    expect(modules.length).toBeGreaterThanOrEqual(6);
    for (const c of modules) {
      const id = c.match(/id="([\w-]+)"/)?.[1];
      expect(c, id).toMatch(/data-label="[^"]+" data-side="(left|right)"/);
      expect(c, id).toMatch(/<h3>[^<]+/);
      expect(c, id).toMatch(/class="ch-shot[^"]*"[^>]*><img src="screenshots\/[\w-]+\.png"[^>]* alt="[^"]+"/);
    }
    // site-3d.js has one key for the hero plus one per chapter, and cuts its panels from real screenshots.
    const story = readFileSync("site/site-3d.js", "utf8");
    const start = story.indexOf("const KEYS = [");
    expect([...story.slice(start, story.indexOf("];", start)).matchAll(/\{ focus: /g)].length).toBe(chapters.length + 1);
    const srcs = [...story.matchAll(/src: "([\w-]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(5);
    for (const name of [...srcs, "overview-dark"]) expect(existsSync(`docs/screenshots/${name}.png`), name).toBe(true);
  });

  it("defines every logo it uses, with the same paths as the app's brand icons", () => {
    const symbols = new Map([...html.matchAll(/<symbol id="i-([\w-]+)" viewBox="0 0 24 24">(.*?)<\/symbol>/g)].map((m) => [m[1], m[2]]));
    const used = new Set([...html.matchAll(/<use href="#i-([\w-]+)"\/>/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(30);
    for (const id of used) expect(symbols.has(id), id).toBe(true);
    for (const [id, body] of symbols) {
      const si = SIMPLE_ICONS[id];
      if (si) expect(body, id).toContain(`d="${si.path}"`);
    }
  });

  it("lists nine ad platforms and seven payment sources", () => {
    const wall = html.indexOf('id="integrations"');
    const row = (title: string) => {
      const start = html.indexOf(`<h3>${title}<span`, wall);
      return [...html.slice(start, html.indexOf("</ul>", start)).matchAll(/<li class="logo">/g)].length;
    };
    expect(row("Ad platforms")).toBe(2 + EXTRA_ADS_CONNECTORS.length);
    expect(row("Payments &amp; stores")).toBe(7);
  });

  it("sells what it has: no comparison section and no competitor names", () => {
    const pages = [html, readFileSync("site/trust.html", "utf8"), readFileSync("docs/FAQ.md", "utf8")];
    for (const page of pages) {
      expect(page).not.toMatch(/Hyros|Triple Whale|Cometly|Northbeam|alternative to/i);
      expect(page).not.toMatch(/#compare|How it compares/);
    }
  });

  it("has a target for every in-page link", () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((a) => !a.startsWith("i-"));
    expect(anchors).toContain("faq");
    for (const a of anchors) expect(ids.has(a), a).toBe(true);
  });

  it("is self-contained apart from fonts, links and the pinned 3D library", () => {
    const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => new URL(m[1]).hostname);
    // Links only: GitHub, the one-click deploy platforms, Docker Desktop and the reader's own install.
    const links = ["github.com", "raw.githubusercontent.com", "render.com", "railway.com", "www.docker.com", "localhost"];
    for (const host of external) expect(["fonts.googleapis.com", "fonts.gstatic.com", ...links]).toContain(host);
    // Scripts are local, except three.js from an exact, pinned version on jsDelivr (through the import map).
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) expect(src).toMatch(/^[\w-]+\.js$/);
    const importmap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    expect(importmap).not.toBeNull();
    const { imports } = JSON.parse(importmap![1]) as { imports: Record<string, string> };
    for (const url of Object.values(imports)) expect(url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\//);
    expect(readFileSync("site/site-3d.js", "utf8")).not.toMatch(/https?:\/\//);
  });
});

describe("FAQ", () => {
  it("is linked from the README and covers the promised topics", () => {
    expect(readFileSync("README.md", "utf8")).toContain("(docs/FAQ.md)");
    const faq = readFileSync("docs/FAQ.md", "utf8");
    for (const q of ["Where does my data go?", "iOS", "How accurate is it?", "What does self-hosting cost?", "Do I need developer accounts?"]) {
      expect(faq).toContain(q);
      expect(html).toContain(q);
    }
  });

  it("only links to docs files and headings that exist", () => {
    // GitHub's heading anchors: lowercase, punctuation dropped, spaces become hyphens.
    const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const anchorsOf = (file: string) =>
      new Set([...readFileSync(file, "utf8").matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
    const faq = readFileSync("docs/FAQ.md", "utf8");
    const links = [...faq.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      const [path, anchor] = link.split("#");
      const file = path ? `docs/${path}` : "docs/FAQ.md";
      expect(existsSync(file), link).toBe(true);
      if (anchor) expect(anchorsOf(file).has(anchor), link).toBe(true);
    }
  });
});

describe("trust page and site copy", () => {
  const trust = readFileSync("site/trust.html", "utf8");
  const visible = (page: string) => page.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");

  it("is linked from the landing page and shares its stylesheet", () => {
    expect(html).toContain('href="trust.html"');
    expect(trust).toContain('href="site.css"');
    expect(html).toContain('href="site.css"');
    expect(existsSync("site/site.css")).toBe(true);
  });

  it("claims no certification: SOC 2 and GDPR appear only as things we don't claim", () => {
    for (const page of [html, trust]) {
      expect(page).not.toMatch(/certified by|<img[^>]*(soc|iso)/i);
      for (const m of visible(page).matchAll(/(SOC 2|ISO 27001|GDPR|HIPAA)[^.]{0,40}(compliant|certified)/gi)) {
        // Allowed only as a quoted "never say" example or in a negative sentence.
        const at = visible(page).indexOf(m[0]);
        expect(visible(page).slice(Math.max(0, at - 80), at + m[0].length + 5), m[0]).toMatch(/“|never|don’t|No badges|Is AdLedger/);
      }
    }
    expect(trust).toContain("We don’t hold SOC 2 or ISO 27001");
  });

  it("has a target for every in-page link and uses no em or en dashes in visible copy", () => {
    const ids = new Set([...trust.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, a] of trust.matchAll(/href="#([^"]+)"/g)) expect(ids.has(a), a).toBe(true);
    for (const page of [html, trust]) expect(visible(page)).not.toMatch(/[–—]/);
  });

  it("is self-contained apart from fonts and GitHub links", () => {
    const external = [...trust.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => new URL(m[1]).hostname);
    for (const host of external) expect(["fonts.googleapis.com", "fonts.gstatic.com", "github.com"]).toContain(host);
  });
});
