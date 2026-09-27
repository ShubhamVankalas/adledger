import { permanentRedirect } from "next/navigation";
import { toQueryString } from "@/lib/period";

// Moved to /customers (redesign brief §3.2). Old links and bookmarks keep their filters.
export default async function LtvRedirect({ searchParams }: PageProps<"/reports/ltv">) {
  permanentRedirect(`/customers${toQueryString(await searchParams)}`);
}
