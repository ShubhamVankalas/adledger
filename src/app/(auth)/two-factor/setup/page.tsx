import { redirect } from "next/navigation";
import { getSessionUser, hasUsers } from "@/lib/auth";
import { EnrollCard } from "./enroll-card";

export const metadata = { title: "Set up two-factor sign-in" };
export const dynamic = "force-dynamic";

// Forced enrolment: the organization requires 2FA and this member hasn't set it up. Every other
// page redirects here (requireUser) until they have.
export default async function TwoFactorSetupPage() {
  const user = await getSessionUser();
  if (!user) redirect((await hasUsers()) ? "/login" : "/setup");
  if (!user.needs2fa) redirect("/");
  return <EnrollCard organization={user.organization.name} />;
}
