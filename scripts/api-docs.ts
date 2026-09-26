// Renders docs/API.md from public/openapi.json. Run after editing the spec:
//   pnpm exec tsx scripts/api-docs.ts
// tests/openapi.test.ts fails when docs/API.md is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
};
type Param = { name: string; in: string; required?: boolean; description?: string; schema: Schema };
type Media = Record<string, { schema: Schema }>;
type Response = { $ref?: string; description?: string; content?: Media };
type Operation = {
  tags?: string[];
  summary: string;
  description?: string;
  security?: unknown[];
  parameters?: Param[];
  requestBody?: { content: Media };
  responses: Record<string, Response>;
};
type Spec = {
  info: { title: string; version: string; description: string };
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; responses: Record<string, Response> };
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const refName = (ref: string) => ref.split("/").pop()!;
const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");

function typeOf(s: Schema): string {
  if (s.$ref) return `[${refName(s.$ref)}](#${anchor(refName(s.$ref))})`;
  if (s.oneOf) return s.oneOf.map(typeOf).join(" or ");
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(", ");
  if (s.type === "array" && s.items) return `${typeOf(s.items)}[]`;
  const t = Array.isArray(s.type) ? s.type.join(" \\| ") : (s.type ?? "any");
  return s.format ? `${t} (${s.format})` : t;
}

function notes(s: Schema): string {
  const extra = [
    s.default !== undefined ? `default \`${JSON.stringify(s.default)}\`` : "",
    s.minimum !== undefined ? `min ${s.minimum}` : "",
    s.maximum !== undefined ? `max ${s.maximum}` : "",
    s.maxLength !== undefined ? `max length ${s.maxLength}` : "",
    s.maxItems !== undefined ? `max ${s.maxItems} items` : "",
    s.pattern ? `pattern \`${s.pattern}\`` : "",
  ].filter(Boolean);
  return [s.description ?? "", extra.length ? `(${extra.join(", ")})` : ""].filter(Boolean).join(" ");
}

function bodyLines(content: Media | undefined): string[] {
  if (!content) return [];
  return Object.entries(content).map(([type, m]) => `\`${type}\`: ${typeOf(m.schema)}`);
}

export function renderApiDocs(spec: Spec): string {
  const out: string[] = [
    "<!-- Generated from public/openapi.json by scripts/api-docs.ts. Do not edit by hand. -->",
    "",
    `# ${spec.info.title} reference (v${spec.info.version})`,
    "",
    "The machine-readable spec is served by every install at `/api/v1/openapi.json` (OpenAPI 3.1) —",
    "load it into Postman, Insomnia, Scalar or an SDK generator.",
    "",
    spec.info.description,
    "",
    "## Endpoints",
    "",
    "| Method | Path | Summary | Auth |",
    "|---|---|---|---|",
  ];
  const sessionOnly = (op: { security?: unknown[] }) => JSON.stringify(op.security ?? []).includes("sessionCookie") && !JSON.stringify(op.security).includes("bearerAuth");
  const ops = Object.entries(spec.paths).flatMap(([p, methods]) => Object.entries(methods).map(([m, op]) => ({ p, m: m.toUpperCase(), op })));
  for (const { p, m, op } of ops) {
    out.push(`| ${m} | [\`${p}\`](#${anchor(`${m} ${p}`)}) | ${cell(op.summary)} | ${op.security?.length === 0 ? "public" : sessionOnly(op) ? "session" : "API key"} |`);
  }

  for (const tag of spec.tags) {
    const tagged = ops.filter((o) => o.op.tags?.includes(tag.name));
    if (!tagged.length) continue;
    out.push("", `## ${tag.name}`, "", tag.description);
    for (const { p, m, op } of tagged) {
      out.push("", `### ${m} ${p}`, "", `**${op.summary}.** ${op.description ?? ""}`.trim(), "");
      out.push(
        op.security?.length === 0
          ? "Auth: none (public endpoint)."
          : sessionOnly(op)
            ? "Auth: dashboard session only (API keys are refused)."
            : "Auth: `Authorization: Bearer al_...` (or a dashboard session).",
      );
      if (op.parameters?.length) {
        out.push("", "| Parameter | In | Type | Required | Description |", "|---|---|---|---|---|");
        for (const x of op.parameters) out.push(`| \`${x.name}\` | ${x.in} | ${cell(typeOf(x.schema))} | ${x.required ? "yes" : "no"} | ${cell(notes({ ...x.schema, description: x.description }))} |`);
      }
      const body = bodyLines(op.requestBody?.content);
      if (body.length) out.push("", `Request body: ${body.join(" · ")}`);
      out.push("", "| Status | Response |", "|---|---|");
      for (const [status, r0] of Object.entries(op.responses)) {
        const r = r0.$ref ? spec.components.responses[refName(r0.$ref)] : r0;
        const b = bodyLines(r.content);
        out.push(`| ${status} | ${cell([r.description ?? "", b.length ? `— ${b.join(" · ")}` : ""].filter(Boolean).join(" "))} |`);
      }
    }
  }

  out.push("", "## Schemas", "", "Fields ending in `Minor` are integers in minor currency units (e.g. cents).");
  for (const [name, s] of Object.entries(spec.components.schemas)) {
    out.push("", `### ${name}`, "");
    if (!s.properties) {
      out.push(`${typeOf(s)}${s.description ? ` — ${s.description}` : ""}`);
      continue;
    }
    if (s.description) out.push(s.description, "");
    out.push("| Field | Type | Required | Description |", "|---|---|---|---|");
    for (const [field, fs] of Object.entries(s.properties)) {
      out.push(`| \`${field}\` | ${cell(typeOf(fs))} | ${s.required?.includes(field) ? "yes" : "no"} | ${cell(notes(fs))} |`);
    }
  }
  return out.join("\n") + "\n";
}

export function loadSpec(root: string): Spec {
  return JSON.parse(readFileSync(path.join(root, "public/openapi.json"), "utf8")) as Spec;
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("api-docs")) {
  const root = path.resolve(path.dirname(process.argv[1]), "..");
  writeFileSync(path.join(root, "docs/API.md"), renderApiDocs(loadSpec(root)));
  console.log("wrote docs/API.md");
}
