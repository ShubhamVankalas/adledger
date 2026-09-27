import { MyTasks } from "@/components/crm/my-tasks";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { crmMembers, myTasks } from "@/lib/reports-crm";

export const metadata = { title: "My tasks" };

export default async function TasksPage() {
  // Tasks are internal team work: clients never see them.
  const user = await requireUser("contacts.notes");
  const ws = user.workspace;
  const db = await getDb();
  const [tasks, members] = await Promise.all([myTasks(db, ws, user.id), crmMembers(db, ws)]);
  return (
    <>
      <PageHeader title="My tasks" description="Follow-ups assigned to you in this workspace" />
      <PageBody>
        <MyTasks tasks={tasks} members={members} viewerId={user.id} canEdit={user.can("contacts.edit")} tz={ws.timezone} now={new Date().toISOString()} />
      </PageBody>
    </>
  );
}
