"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { answerQuestion, askHistory, clearAskHistory, pruneAskHistory } from "@/lib/ai/ask";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { rateLimit } from "@/lib/http";

// Insights → Ask. Answers come from read-only, SQL-backed tools; history is per user.

export async function askAction(question: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("insights.ask");
    const q = String(question ?? "").trim();
    if (!q) return fail("Type a question first.");
    if (q.length > 1000) return fail("Keep questions under 1,000 characters.");
    if (!rateLimit(`ask:${user.id}`, 12)) return fail("That’s a lot of questions at once. Wait a minute and try again.");
    const db = await getDb();
    const ws = user.workspace;
    const history = (await askHistory(db, ws.id, user.id, 6)).map((m) => ({ role: m.role, content: m.content }));
    const askedAt = new Date();
    const answer = await answerQuestion(db, ws, q, { history });
    const [, saved] = await db
      .insert(schema.askMessages)
      .values([
        { workspaceId: ws.id, userId: user.id, role: "user", content: q, createdAt: askedAt },
        {
          workspaceId: ws.id,
          userId: user.id,
          role: "assistant",
          content: answer.content,
          tables: answer.tables,
          unverifiedNumbers: answer.unverifiedNumbers,
          modelName: answer.modelName,
          // Both stamped here (not by the database clock), so the answer always sorts right after its question.
          createdAt: new Date(askedAt.getTime() + 1),
        },
      ])
      .returning();
    await pruneAskHistory(db, ws.id, user.id);
    // IDs only: questions can contain anything the person typed.
    await audit(user, "ask.question", saved.id, { model: answer.modelName, tables: answer.tables.length, unverified: answer.unverifiedNumbers.length });
    return ok(undefined, {
      message: {
        id: saved.id,
        role: "assistant",
        content: saved.content,
        tables: saved.tables,
        unverifiedNumbers: saved.unverifiedNumbers,
        modelName: saved.modelName,
        createdAt: saved.createdAt.toISOString(),
      },
      error: answer.error ?? null,
    });
  });
}

export async function clearAskHistoryAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("insights.ask");
    const db = await getDb();
    await clearAskHistory(db, user.workspace.id, user.id);
    await audit(user, "ask.clear_history", user.id);
    revalidatePath("/insights");
    return ok("Conversation cleared.");
  });
}
