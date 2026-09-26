import nodemailer from "nodemailer";
import type { ConnectionLike, NotificationChannelDriver, NotificationMessage } from "../../connectors/types";
import {
  BRAND_COLOR,
  HTTP_TIMEOUT_MS,
  escapeHtml,
  redact,
  safeUrl,
  severityColor,
  severityLabel,
  splitList,
  toHtml,
  toPlain,
} from "../format";

export type RenderedEmail = { subject: string; html: string; text: string };

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Render a notification as a responsive, inline-styled HTML email + plain-text alternative. */
export function renderEmail(msg: NotificationMessage): RenderedEmail {
  const sevColor = severityColor(msg.severity);
  const sevLabel = severityLabel(msg.severity);
  const url = safeUrl(msg.url);
  const fields = msg.fields ?? [];
  const subject = msg.severity === "warning" || msg.severity === "critical" ? `[${sevLabel}] ${msg.title}` : msg.title;

  const body = toHtml(msg.text, {
    p: "margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2937;",
    ul: "margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.55;color:#1f2937;",
    li: "margin:0 0 4px;",
  });

  const fieldRows = fields
    .map(
      (f, i) =>
        `<tr><td style="padding:8px 12px;font-size:13px;color:#6b7280;width:40%;vertical-align:top;${i ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(f.label)}</td>` +
        `<td style="padding:8px 12px;font-size:14px;color:#111827;font-weight:600;vertical-align:top;${i ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(f.value)}</td></tr>`,
    )
    .join("");
  const fieldsTable = fields.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin:4px 0 18px;">${fieldRows}</table>`
    : "";

  const button = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr><td style="border-radius:6px;background:${BRAND_COLOR};">` +
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Open AdLedger</a>` +
      `</td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:${FONT};">
<tr><td style="background:${BRAND_COLOR};padding:14px 24px;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">AdLedger</td></tr>
<tr><td style="padding:24px 24px 8px;">
<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${sevColor};color:#ffffff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">${escapeHtml(sevLabel)}</span>
<h1 style="margin:12px 0 16px;font-size:20px;line-height:1.3;color:#111827;">${escapeHtml(msg.title)}</h1>
${body}
${fieldsTable}
${button}
</td></tr>
<tr><td style="padding:16px 24px 22px;font-size:12px;color:#9ca3af;">Sent by AdLedger notifications. Manage alerts in Settings &rarr; Notifications.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textParts = [`${msg.title}`, `Severity: ${sevLabel}`, toPlain(msg.text)];
  if (fields.length) textParts.push(fields.map((f) => `${f.label}: ${f.value}`).join("\n"));
  if (url) textParts.push(`Open AdLedger: ${url}`);
  const text = textParts.filter(Boolean).join("\n\n");

  return { subject, html, text };
}

type Transport = { transporter: ReturnType<typeof nodemailer.createTransport>; from: string; secrets: string[] };

/** Build an SMTP transport from a connection, falling back to SMTP_URL / SMTP_FROM env vars. */
function buildTransport(conn?: ConnectionLike): Transport {
  const cfg = conn?.config ?? {};
  const password = conn?.secrets?.password ?? "";
  const host = (cfg.host ?? "").trim();
  if (host) {
    const from = (cfg.from ?? "").trim() || (process.env.SMTP_FROM ?? "").trim();
    if (!from) throw new Error("Email: the From address is not set");
    const port = Number(cfg.port) || 587;
    const secure = cfg.secure ? cfg.secure.trim().toLowerCase() === "true" : port === 465;
    const username = (cfg.username ?? "").trim();
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: username ? { user: username, pass: password } : undefined,
      connectionTimeout: HTTP_TIMEOUT_MS,
      greetingTimeout: HTTP_TIMEOUT_MS,
      socketTimeout: HTTP_TIMEOUT_MS,
    });
    return { transporter, from, secrets: [password] };
  }
  const smtpUrl = (process.env.SMTP_URL ?? "").trim();
  if (smtpUrl) {
    const from = (cfg.from ?? "").trim() || (process.env.SMTP_FROM ?? "").trim();
    if (!from) throw new Error("Email: SMTP_FROM is not set");
    return { transporter: nodemailer.createTransport(smtpUrl), from, secrets: [smtpUrl, password] };
  }
  throw new Error("Email is not configured: set an SMTP host, or SMTP_URL in the environment");
}

/**
 * Send a notification email. Usable outside the channel system (e.g. invitations):
 * omit `conn` to use the SMTP_URL / SMTP_FROM environment fallback.
 */
export async function sendEmail(opts: {
  to: string | string[];
  subject?: string;
  msg: NotificationMessage;
  conn?: ConnectionLike;
}): Promise<void> {
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to]).flatMap((t) => splitList(t));
  if (!to.length) throw new Error("Email: no recipients");
  const { transporter, from, secrets } = buildTransport(opts.conn);
  const rendered = renderEmail(opts.msg);
  try {
    await transporter.sendMail({
      from,
      to: to.join(", "),
      subject: opts.subject ?? rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    const e = err as Error & { responseCode?: number; response?: string };
    const code = e.responseCode ? ` (SMTP ${e.responseCode})` : "";
    throw new Error(`Email send failed${code}: ${redact(e.message ?? String(err), secrets).slice(0, 200)}`);
  }
}

export const emailDriver: NotificationChannelDriver = {
  type: "email",
  meta: {
    provider: "notify_email",
    name: "Email",
    category: "notifications",
    description: "Send alerts and reports to one or more inboxes through any SMTP server (Gmail, Outlook, SendGrid, Postmark…).",
    fields: [
      { name: "host", label: "SMTP host", placeholder: "smtp.gmail.com", hint: "Leave empty to use the server's SMTP_URL setting", optional: true },
      { name: "port", label: "Port", placeholder: "587", optional: true },
      { name: "secure", label: "Use SSL/TLS (true/false)", placeholder: "false", hint: "\"true\" for port 465, \"false\" for 587 (STARTTLS)", optional: true },
      { name: "username", label: "Username", placeholder: "you@yourcompany.com", optional: true },
      { name: "password", label: "Password / app password", secret: true, optional: true },
      { name: "from", label: "From address", placeholder: "AdLedger <alerts@yourcompany.com>", optional: true },
      { name: "to", label: "Send to", placeholder: "founder@yourcompany.com, team@yourcompany.com", hint: "Separate several addresses with commas" },
    ],
    steps: [
      "Find your email provider's SMTP settings (host, port and username) — for Gmail use smtp.gmail.com, port 587.",
      "Create an app password in your email account's security settings and paste it as the password.",
      "Enter the address alerts should come from and the addresses that should receive them, then send a test.",
    ],
    docsUrl: "https://nodemailer.com/smtp/",
    status: "stable",
    color: BRAND_COLOR,
  },
  async send(conn, msg) {
    await sendEmail({ to: conn.config.to ?? "", msg, conn });
  },
};
