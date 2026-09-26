import { redirect } from "next/navigation";
import { hasUsers } from "@/lib/auth";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasUsers()) redirect("/login");
  return <SetupForm />;
}
