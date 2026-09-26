"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getAdsConnector } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";
import { oauthCredentials } from "@/lib/oauth/flow";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { openPending, PENDING_COOKIE } from "@/lib/oauth/state";
import { getAppSecret, saveConnection } from "@/lib/settings";
import { syncProvider } from "@/lib/sync";

// Last step of one-click connect: save the accounts the user picked and start importing.

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function finishOAuthConnectAction(provider: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const p = getOAuthProvider(provider);
    const connector = getAdsConnector(provider);
    if (!p || !connector) return fail("Unknown integration.");
    const jar = await cookies();
    const pending = openPending(jar.get(PENDING_COOKIE)?.value, await getAppSecret(), {
      provider,
      userId: user.id,
      workspaceId: user.workspace.id,
    });
    if (!pending) return fail("This sign-in has expired. Click Connect again.");
    const creds = oauthCredentials(provider);
    if (!creds) return fail("One-click connect isn't set up on this server any more.");
    const ids = [...new Set(form.getAll("account").map((v) => String(v).trim()))].filter((v) => ACCOUNT_ID.test(v)).slice(0, 200);
    if (ids.length === 0) return fail("Pick at least one ad account.");

    const { config, secrets } = p.connection(pending.tokens, ids, creds);
    const db = await getDb();
    // The new sign-in replaces every stored secret (e.g. a pasted refresh token from another app).
    // One transaction, so a failed save can't leave the connection without any secrets.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.connections)
        .set({ secretsEnc: null })
        .where(and(eq(schema.connections.workspaceId, user.workspace.id), eq(schema.connections.provider, provider)));
      await saveConnection(user.workspace.id, provider, { mode: "live", enabled: true, config, secrets }, tx);
    });
    await audit(user, "integration.oauth_connected", provider, { accounts: ids.length });
    jar.delete(PENDING_COOKIE);
    revalidatePath("/settings", "layout");
    // Import right away in the background; the status appears on the card.
    void syncProvider(db, user.workspace.id, provider).then(() => undefined, () => undefined);
    const n = ids.length === 1 ? "1 account" : `${ids.length} accounts`;
    return ok(`${connector.meta.name} connected (${n}). Importing your data now — this can take a minute.`);
  });
}
