// RFC 9116 security.txt. The software's own reporting channel is always listed; an operator can put
// their own contact first with SECURITY_CONTACT (an email address or an https:// URL).

export const PROJECT_URL = "https://github.com/ShubhamVankalas/adledger";
const PROJECT_CONTACT = `${PROJECT_URL}/security/advisories/new`;
const POLICY = `${PROJECT_URL}/blob/main/SECURITY.md`;

/** Days until Expires. RFC 9116 asks for less than a year; the file is generated per request. */
const EXPIRES_DAYS = 180;

/** mailto:/https: URI for an operator contact, or null when it isn't one of those. */
export function contactUri(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v || /[\s<>"]/.test(v)) return null;
  if (/^mailto:[^@]+@[^@]+\.[^@]+$/i.test(v)) return v;
  if (/^[^@:/]+@[^@]+\.[^@]+$/.test(v)) return `mailto:${v}`;
  try {
    const url = new URL(v);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function securityTxt(operatorContact?: string, now = new Date()): string {
  const expires = new Date(now.getTime() + EXPIRES_DAYS * 86_400_000);
  expires.setUTCHours(0, 0, 0, 0);
  const own = contactUri(operatorContact);
  const lines = [
    "# Vulnerabilities in this install: the operator's contact (if set).",
    "# Vulnerabilities in the AdLedger software: the project's private reporting form.",
    ...(own ? [`Contact: ${own}`] : []),
    `Contact: ${PROJECT_CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    `Policy: ${POLICY}`,
    "Preferred-Languages: en",
  ];
  return `${lines.join("\n")}\n`;
}
