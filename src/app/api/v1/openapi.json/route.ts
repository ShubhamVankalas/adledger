import spec from "../../../../../public/openapi.json";
import { json } from "@/lib/http";

// GET /api/v1/openapi.json — the OpenAPI 3.1 description of this API (public/openapi.json,
// bundled at build time so it works in the standalone Docker image).
export function GET() {
  return json(spec, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
