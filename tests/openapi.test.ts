import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as openapiRoute } from "@/app/api/v1/openapi.json/route";
import { loadSpec, renderApiDocs } from "../scripts/api-docs";

// Contract: public/openapi.json documents exactly the routes under src/app/api/v1,
// with the same HTTP methods, and docs/API.md covers every operation.

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "src/app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

type Spec = {
  openapi: string;
  paths: Record<string, Record<string, { parameters?: { name: string; in: string; $ref?: string }[]; security?: unknown[]; responses: object }>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, { type: string; scheme?: string }> };
  security: Record<string, string[]>[];
};
const spec = JSON.parse(readFileSync(path.join(ROOT, "public/openapi.json"), "utf8")) as Spec;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** src/app/api/v1/contacts/[id]/journey/route.ts → /api/v1/contacts/{id}/journey */
function toOpenApiPath(file: string) {
  const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep).filter(Boolean);
  return "/api/v1/" + rel.map((seg) => seg.replace(/^\[(.+)\]$/, "{$1}")).join("/");
}

/** HTTP methods a route module exports (function, const or `export { x as GET }`). */
function exportedMethods(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/g)) found.add(m[1]);
  for (const block of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of block[1].split(",")) found.add(part.split(/\s+as\s+/).pop()!.trim());
  }
  return [...found].filter((m) => (METHODS as readonly string[]).includes(m)).map((m) => m.toLowerCase()).sort();
}

const routes = routeFiles(API_DIR).map((f) => ({ file: f, path: toOpenApiPath(f), methods: exportedMethods(f) }));

describe("OpenAPI contract", () => {
  it("is an OpenAPI 3.1 document with bearer auth", () => {
    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(spec.security).toContainEqual({ bearerAuth: [] });
  });

  it("finds the route files", () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
    for (const r of routes) expect(r.methods.length, r.file).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [r.path, r] as const))("documents %s with the same methods", (p, r) => {
    expect(spec.paths[p], `missing path ${p} in public/openapi.json`).toBeDefined();
    expect(Object.keys(spec.paths[p]).sort()).toEqual(r.methods);
  });

  it("documents no /api/v1 path that doesn't exist", () => {
    const real = new Set(routes.map((r) => r.path));
    const documented = Object.keys(spec.paths).filter((p) => p.startsWith("/api/v1/"));
    expect(documented.filter((p) => !real.has(p))).toEqual([]);
  });

  it("declares every path parameter and resolves every $ref", () => {
    for (const [p, ops] of Object.entries(spec.paths)) {
      const names = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      for (const [method, op] of Object.entries(ops)) {
        const declared = (op.parameters ?? []).filter((x) => x.in === "path").map((x) => x.name).sort();
        expect(declared, `${method.toUpperCase()} ${p}`).toEqual(names);
        expect(Object.keys(op.responses).length, `${method.toUpperCase()} ${p}`).toBeGreaterThan(0);
      }
    }
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = ref.split("/").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], spec);
      expect(target, `#/${ref}`).toBeDefined();
    }
  });

  it("marks public (non-API-key) endpoints explicitly", () => {
    const publicOps = ["/api/v1/health", "/api/v1/collect", "/api/v1/webhooks/leads/{token}", "/api/v1/webhooks/stripe/{workspaceId}"];
    for (const p of publicOps) expect(spec.paths[p].post?.security ?? spec.paths[p].get?.security, p).toEqual([]);
    expect(spec.paths["/api/v1/reports/{report}"].get.security).toBeUndefined();
    expect(spec.paths["/api/v1/spend"].post.security).toBeUndefined();
  });

  it("docs/API.md is generated from the spec and up to date (pnpm exec tsx scripts/api-docs.ts)", () => {
    const md = readFileSync(path.join(ROOT, "docs/API.md"), "utf8").replace(/\r\n/g, "\n");
    expect(md).toBe(renderApiDocs(loadSpec(ROOT)));
    for (const [p, ops] of Object.entries(spec.paths)) {
      for (const method of Object.keys(ops)) expect(md, `${method.toUpperCase()} ${p}`).toContain(`### ${method.toUpperCase()} ${p}`);
    }
  });

  it("is served at /api/v1/openapi.json", async () => {
    const res = openapiRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Spec;
    expect(body.openapi).toBe(spec.openapi);
    expect(Object.keys(body.paths)).toEqual(Object.keys(spec.paths));
  });
});
