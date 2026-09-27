import { redirect } from "next/navigation";
import { pendingChallengeUser } from "@/lib/auth";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Two-factor sign-in" };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  if (!(await pendingChallengeUser())) redirect("/login");
  const sp = await searchParams;
  return <VerifyForm next={typeof sp.next === "string" ? sp.next : "/"} />;
}
