import { ListTodoIcon } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My tasks" };

export default async function TasksPage() {
  await requireUser();
  return (
    <ComingSoon
      title="My tasks"
      icon={ListTodoIcon}
      headline="My tasks is coming in the next update"
      body="Follow-ups on your leads and customers, grouped into overdue, today and upcoming."
    />
  );
}
