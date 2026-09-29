"use server";

import { DocumentGenerationFailed, generateAiDocument, NoModelConfigured, type DocumentIssue } from "@/lib/ai/document";
import { getDocumentTemplate } from "@/lib/ai/document-prompts";
import { previewDocument } from "@/lib/ai/document-preview";
import { documentRequestSchema } from "@/lib/ai/document-schema";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/http";
import { log } from "@/lib/log";
import { generateAiDocumentPdf } from "@/lib/pdf/ai-document";
import { Busy, pdfLimiter } from "@/lib/pdf/limiter";

// Reports → AI document. The connected model writes the structure, our code draws the PDF from
// SQL figures. The audit log gets ids and counts only: never the request or the document text.

export type AiDocumentInput = { templateId: string | null; prompt: string; start: string; end: string; model: string };

/** What the page shows about a removed or adjusted part of the document. */
export type IssueNote = { kind: DocumentIssue["kind"]; text: string };

function describe(i: DocumentIssue): IssueNote {
  switch (i.kind) {
    case "unverified_number":
      return { kind: i.kind, text: `Removed from the ${i.where}: “${i.removed}” (${i.numbers.join(", ")} isn't in your data).` };
    case "unknown_reference":
      return { kind: i.kind, text: `Skipped a block in the ${i.where} that pointed at “${i.id}”, which isn't in the data.` };
    case "adjusted_chart":
      return { kind: i.kind, text: `Drew a ${i.used} chart in the ${i.where} instead of a ${i.requested} chart, which doesn't fit that data.` };
    case "trimmed":
      return { kind: i.kind, text: `Shortened the ${i.where} to fit the page limits.` };
  }
}

export async function generateAiDocumentAction(input: AiDocumentInput): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.pdf");
    if (!user.can("insights.generate")) return fail("Your role can't use the workspace's AI model. Ask an admin.");
    const parsed = documentRequestSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the request and try again.");
    const req = { ...parsed.data, templateId: getDocumentTemplate(parsed.data.templateId) ? parsed.data.templateId : null };
    const ws = user.workspace;
    if (!rateLimit(`aidoc:${user.id}`, 4) || !rateLimit(`aidoc-ws:${ws.id}`, 12)) return fail("That’s a lot of documents at once. Wait a minute and try again.");

    const db = await getDb();
    let gen;
    try {
      gen = await generateAiDocument(db, ws, req);
    } catch (err) {
      if (err instanceof NoModelConfigured || err instanceof DocumentGenerationFailed) return fail(err.message);
      throw err;
    }
    let out;
    try {
      out = await pdfLimiter.run(() => generateAiDocumentPdf(db, ws, gen, { via: "session", userId: user.id, name: user.name?.trim() || `${user.organization.name} member` }));
    } catch (err) {
      if (err instanceof Busy) return fail("Other reports are rendering. Try again in a few seconds.");
      log.error("ai document render failed", err);
      return fail("The document was written but couldn't be laid out as a PDF. Check the server logs.");
    }
    const removed = gen.issues.filter((i) => i.kind === "unverified_number").length;
    await audit(user, "report.ai_document_generated", out.exportId, {
      template: req.templateId ?? "custom",
      model: gen.modelName,
      start: req.start,
      end: req.end,
      sections: gen.document.sections.length,
      pages: out.pages,
      removedSentences: removed,
      issues: gen.issues.length,
    });
    return ok(undefined, {
      pdf: out.pdf.toString("base64"),
      filename: out.filename,
      title: out.title,
      pages: out.pages,
      exportId: out.exportId,
      fingerprint: out.fingerprint,
      modelName: gen.modelName,
      preview: previewDocument(gen.document, gen.pack),
      issues: gen.issues.slice(0, 20).map(describe),
    });
  });
}
