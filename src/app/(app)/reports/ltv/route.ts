import { movedPermanently } from "@/lib/period";

// Moved to /customers (redesign brief §3.2). A 308 that keeps every filter in the query string.
export function GET(req: Request) {
  return movedPermanently(req, "/customers");
}
