import { permanentRedirect } from "next/navigation";
import { toQueryString } from "@/lib/period";

// Moved to /attribution (redesign brief §3.2). Old links and bookmarks keep their filters.
export default async function ModelsRedirect({ searchParams }: PageProps<"/reports/models">) {
  permanentRedirect(`/attribution${toQueryString(await searchParams)}`);
}
