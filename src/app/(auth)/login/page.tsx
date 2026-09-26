import { redirect } from "next/navigation";
import { getSessionUser, hasUsers } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await hasUsers())) redirect("/setup");
  if (await getSessionUser()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return <LoginForm next={next} />;
}
