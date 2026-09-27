"use client";

import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmTwoFactorAction, startTwoFactorAction } from "@/app/actions/security";
import { useCopy } from "@/components/copy-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Enrollment = { secret: string; uri: string; qr: { size: number; path: string } };

/** The 6-digit code field used by enrolment, the sign-in challenge and the confirm dialogs. */
export function CodeInput({ id, allowRecovery = false, className, ...props }: { id: string; allowRecovery?: boolean } & React.ComponentProps<typeof Input>) {
  return (
    <Input
      id={id}
      name="code"
      required
      autoComplete="one-time-code"
      inputMode={allowRecovery ? "text" : "numeric"}
      pattern={allowRecovery ? undefined : "[0-9 ]{6,7}"}
      maxLength={allowRecovery ? 16 : 7}
      spellCheck={false}
      autoCapitalize="none"
      placeholder={allowRecovery ? "123456 or recovery code…" : "123456"}
      className={cn("h-11 font-mono text-lg tracking-[0.2em] placeholder:tracking-normal placeholder:font-sans placeholder:text-sm md:h-10", className)}
      {...props}
    />
  );
}

/** A QR code drawn from path data, always dark-on-white so every camera can read it. */
function Qr({ qr, label }: { qr: Enrollment["qr"]; label: string }) {
  return (
    <div className="w-fit shrink-0 rounded-lg bg-white p-2 shadow-[0_0_0_1px_oklch(0.2_0.02_165/0.08)]">
      <svg role="img" aria-label={label} viewBox={`0 0 ${qr.size} ${qr.size}`} className="size-40 sm:size-44" shapeRendering="crispEdges">
        <path d={qr.path} fill="#15181a" />
      </svg>
    </div>
  );
}

/** Recovery codes, shown once: copy, download, and a confirmation before leaving. */
export function RecoveryCodes({ codes, onDone, doneLabel = "Done" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const { copied, copy } = useCopy();
  const [saved, setSaved] = useState(false);
  const checkId = useId();
  const text = `AdLedger recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "adledger-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-medium">Save your recovery codes</p>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
          If you lose your phone, each code signs you in once. They won&rsquo;t be shown again.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 font-mono text-sm tabular-nums" translate="no" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void copy(codes.join("\n"));
            setSaved(true);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon /> Download
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? "Recovery codes copied" : ""}
        </span>
      </div>
      <label htmlFor={checkId} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
        <input id={checkId} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-foreground" />
        I&rsquo;ve saved these codes somewhere safe
      </label>
      <div>
        <Button type="button" disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Two-step enrolment: scan (or type) the secret, confirm with a code, then save recovery codes.
 * Used on Settings → Account → Security and on the forced-enrolment screen.
 */
export function TwoFactorEnroll({ onFinished, onCancel, finishLabel }: { onFinished: () => void; onCancel?: () => void; finishLabel?: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);
  const codeId = useId();
  const { copied, copy } = useCopy();

  const started = useRef(false);
  const begin = () =>
    start(async () => {
      const r = await startTwoFactorAction();
      if (!r.ok) {
        toast.error(r.message ?? "Couldn't start setup. Try again.");
        return;
      }
      setEnrollment(r.data as Enrollment);
      setTimeout(() => codeRef.current?.focus(), 50);
    });
  // Start right away. The ref keeps a re-run effect (Strict Mode) from creating a second secret.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    begin();
  }, []);

  const confirm = (form: FormData) =>
    start(async () => {
      const r = await confirmTwoFactorAction(form);
      if (!r.ok) {
        setError(r.message ?? "That code didn't match.");
        codeRef.current?.select();
        return;
      }
      setError(null);
      setCodes((r.data?.codes as string[]) ?? []);
    });

  if (codes) return <RecoveryCodes codes={codes} onDone={onFinished} doneLabel={finishLabel} />;

  if (!enrollment) {
    return (
      <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
        {pending ? (
          <p className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon aria-hidden className="size-4 animate-spin" /> Preparing your setup code…
          </p>
        ) : (
          <Button type="button" onClick={begin}>
            Try again
          </Button>
        )}
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form action={confirm} className="grid gap-5">
      <ol className="grid gap-5 text-sm">
        <li className="grid gap-3">
          <p>
            <span className="font-medium">1. Scan this code</span> with an authenticator app such as 1Password, Bitwarden, Google Authenticator or Authy.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Qr qr={enrollment.qr} label="QR code for your authenticator app" />
            <div className="min-w-0 space-y-1.5">
              <p className="text-muted-foreground">Can&rsquo;t scan it? Enter this key instead:</p>
              <div className="flex items-center gap-2">
                <code translate="no" className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-[13px] tracking-wide break-all">
                  {enrollment.secret}
                </code>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Copy key" onClick={() => void copy(enrollment.secret.replace(/\s/g, ""))}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Time-based, 6 digits, every 30 seconds.</p>
            </div>
          </div>
        </li>
        <li className="grid gap-2">
          <Label htmlFor={codeId} className="font-medium">
            2. Enter the 6-digit code the app shows
          </Label>
          <div className="flex max-w-sm gap-2">
            <CodeInput
              id={codeId}
              ref={codeRef}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${codeId}-error` : undefined}
              onChange={() => error && setError(null)}
            />
            <Button type="submit" disabled={pending} className="h-11 shrink-0 md:h-10">
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Checking…" : "Verify"}
            </Button>
          </div>
          {error ? (
            <p id={`${codeId}-error`} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </li>
      </ol>
      {onCancel ? (
        <div>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : null}
    </form>
  );
}
