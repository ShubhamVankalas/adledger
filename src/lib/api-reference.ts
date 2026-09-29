import spec from "../../public/openapi.json";

// Developers → API reference: the operations in public/openapi.json that an API key can call,
// with ready-to-run curl / JavaScript / Python examples built from the spec's own schemas.

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  description?: string;
  format?: string;
  default?: unknown;
  minimum?: number;
  example?: unknown;
};
type Param = { name: string; in: string; required?: boolean; description?: string; schema: Schema };
type Operation = { tags?: string[]; summary: string; description?: string; security?: unknown[]; parameters?: Param[]; requestBody?: { content: Record<string, { schema: Schema }> } };
type Spec = { tags: { name: string; description: string }[]; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };

const SPEC = spec as unknown as Spec;

export type RefParam = { name: string; in: string; required: boolean; type: string; description: string };
export type RefOperation = {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  params: RefParam[];
  write: boolean;
  examples: { curl: string; js: string; python: string };
};
export type RefGroup = { tag: string; description: string; ops: RefOperation[] };

const resolve = (s: Schema): Schema => (s.$ref ? (SPEC.components.schemas[s.$ref.split("/").pop()!] ?? {}) : s);

function typeLabel(s0: Schema): string {
  const s = resolve(s0);
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.type === "array" && s.items) return `${typeLabel(s.items)}[]`;
  const t = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "object");
  return s.format ? `${t} (${s.format})` : t;
}

/** A small, valid example value for a schema (required fields only, one array item). */
export function exampleFor(s0: Schema, depth = 0): unknown {
  const s = resolve(s0);
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  if (s.default !== undefined) return s.default;
  if (s.oneOf?.length) return exampleFor(s.oneOf[0], depth);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "string") {
    if (s.format === "date") return "2026-09-01";
    if (s.format === "date-time") return "2026-09-01T12:00:00Z";
    if (s.format === "uuid") return "5b1f3a9e-2c4d-4e8f-9a1b-3c5d7e9f1a2b";
    if (s.format === "email") return "jane@example.com";
    return "string";
  }
  if (type === "integer" || type === "number") return s.minimum ?? 1;
  if (type === "boolean") return true;
  if (type === "array") return depth > 3 || !s.items ? [] : [exampleFor(s.items, depth + 1)];
  if (s.properties && depth <= 3) {
    const keys = s.required?.length ? s.required : Object.keys(s.properties).slice(0, 3);
    return Object.fromEntries(keys.filter((k) => s.properties![k]).map((k) => [k, exampleFor(s.properties![k], depth + 1)]));
  }
  return {};
}

/** JSON → Python literal (True/False/None). */
function py(v: unknown, indent = 0): string {
  const pad = "    ".repeat(indent + 1);
  const end = "    ".repeat(indent);
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + py(x, indent + 1)).join(",\n")},\n${end}]` : "[]";
  const entries = Object.entries(v as Record<string, unknown>);
  return entries.length ? `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${py(x, indent + 1)}`).join(",\n")},\n${end}}` : "{}";
}

function examples(origin: string, method: string, path: string, op: Operation) {
  const params = op.parameters ?? [];
  let url = path;
  for (const p of params.filter((x) => x.in === "path")) url = url.replace(`{${p.name}}`, encodeURIComponent(String(exampleFor(p.schema))));
  const query = new URLSearchParams();
  for (const p of params.filter((x) => x.in === "query" && x.required)) query.set(p.name, String(exampleFor(p.schema)));
  const full = `${origin}${url}${query.size ? `?${query.toString()}` : ""}`;
  const json = op.requestBody?.content["application/json"];
  const body = json ? exampleFor(json.schema) : undefined;
  const M = method.toUpperCase();
  const bodyJson = body === undefined ? null : JSON.stringify(body, null, 2);

  const curl = [
    `curl${M === "GET" ? "" : ` -X ${M}`} "${full}" \\`,
    `  -H "Authorization: Bearer $ADLEDGER_API_KEY"${bodyJson ? " \\" : ""}`,
    ...(bodyJson ? [`  -H "Content-Type: application/json" \\`, `  -d '${bodyJson.replace(/'/g, "'\\''")}'`] : []),
  ].join("\n");

  const js = [
    `const res = await fetch("${full}", {`,
    ...(M === "GET" ? [] : [`  method: "${M}",`]),
    `  headers: {`,
    `    Authorization: \`Bearer \${process.env.ADLEDGER_API_KEY}\`,`,
    ...(bodyJson ? [`    "Content-Type": "application/json",`] : []),
    `  },`,
    ...(bodyJson ? [`  body: JSON.stringify(${bodyJson.replace(/\n/g, "\n  ")}),`] : []),
    `});`,
    `if (!res.ok) throw new Error(\`AdLedger \${res.status}: \${await res.text()}\`);`,
    `const data = await res.json();`,
  ].join("\n");

  const python = [
    `import os, requests`,
    ``,
    `res = requests.${method.toLowerCase()}(`,
    `    "${full}",`,
    `    headers={"Authorization": f"Bearer {os.environ['ADLEDGER_API_KEY']}"},`,
    ...(body !== undefined ? [`    json=${py(body, 1)},`] : []),
    `    timeout=30,`,
    `)`,
    `res.raise_for_status()`,
    `data = res.json()`,
  ].join("\n");

  return { curl, js, python };
}

const isKeyOperation = (op: Operation) => {
  if (op.security && op.security.length === 0) return false; // public (pixel, inbound webhooks, health)
  const sec = JSON.stringify(op.security ?? []);
  return !(sec.includes("sessionCookie") && !sec.includes("bearerAuth")); // dashboard-only downloads
};

/** Operations an API key can call, grouped by the spec's tags (in the spec's order). */
export function apiReference(origin: string): RefGroup[] {
  const groups: RefGroup[] = [];
  for (const tag of SPEC.tags) {
    const ops: RefOperation[] = [];
    for (const [path, methods] of Object.entries(SPEC.paths)) {
      if (path === "/api/v1/openapi.json") continue;
      for (const [method, op] of Object.entries(methods)) {
        if (!op.tags?.includes(tag.name) || method === "options" || !isKeyOperation(op)) continue;
        ops.push({
          id: `${method}-${path}`.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "").toLowerCase(),
          method: method.toUpperCase(),
          path,
          summary: op.summary,
          description: op.description ?? "",
          write: method !== "get",
          params: (op.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: Boolean(p.required), type: typeLabel(p.schema), description: p.description ?? resolve(p.schema).description ?? "" })),
          examples: examples(origin, method, path, op),
        });
      }
    }
    if (ops.length) groups.push({ tag: tag.name, description: tag.description, ops });
  }
  return groups;
}
