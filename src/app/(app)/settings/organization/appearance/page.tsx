import { SettingsHeader } from "@/components/settings/section";
import { ThemePicker } from "@/components/settings/theme-picker";
import { requireUser } from "@/lib/auth";
import { parseTheme } from "@/lib/themes";

export const metadata = { title: "Appearance" };

export default async function OrganizationAppearancePage() {
  const user = await requireUser("org.branding");
  return (
    <>
      <SettingsHeader
        title="Appearance"
        description={`The accent colour everyone in ${user.organization.name} sees. Profit and loss stay green and red, so money always reads the same.`}
      />
      <ThemePicker saved={parseTheme(user.organization.theme)} organizationName={user.organization.name} />
    </>
  );
}
