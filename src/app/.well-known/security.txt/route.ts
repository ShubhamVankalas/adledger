import { securityTxt } from "@/lib/security/security-txt";

// GET /.well-known/security.txt (RFC 9116): where to report a vulnerability in this install
// (SECURITY_CONTACT, when the operator sets it) and in the AdLedger software itself.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(securityTxt(process.env.SECURITY_CONTACT), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
