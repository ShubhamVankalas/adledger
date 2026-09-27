import { CopyCheckIcon } from "lucide-react";
import Link from "next/link";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth";
import { findDuplicates } from "@/lib/contacts-merge";
import { getDb } from "@/lib/db";
import { DuplicatesList } from "./duplicates-list";

export const metadata = { title: "Duplicates" };

export default async function DuplicatesPage() {
  const user = await requireUser("workspace.settings");
  const pairs = await findDuplicates(await getDb(), user.workspace, { limit: 50 });
  const strong = pairs.filter((p) => p.strength === "strong").length;
  const canMerge = user.can("workspace.data");

  return (
    <>
      <SettingsHeader
        title="Duplicates"
        description="People who ended up as two contacts, usually a phone-only lead (WhatsApp, a call form) and the email they later paid with. Merging joins their journeys, so the payment is credited to the ad that brought them in."
      >
        <Button variant="outline" size="sm" render={<Link href="/settings/workspace/import" />}>
          Import contacts
        </Button>
      </SettingsHeader>

      {pairs.length === 0 ? (
        <Empty className="border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CopyCheckIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No duplicates found</EmptyTitle>
            <EmptyDescription>
              We look for contacts that share a phone number, the same email written differently (dots and +tags in Gmail), and the same name where one has no email. New suggestions appear here as leads come in.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" render={<Link href="/contacts" />}>
              Open contacts
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DuplicatesList
          pairs={pairs}
          currency={user.workspace.reportingCurrency}
          canMerge={canMerge}
          summary={[strong ? `${strong} likely` : null, pairs.length - strong ? `${pairs.length - strong} possible` : null].filter(Boolean).join(" · ")}
          capped={pairs.length >= 50}
        />
      )}
    </>
  );
}
