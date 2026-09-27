"use client";

import { ImageUpIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions";
import { MAX_SOURCE_BYTES, MEDIA_SIZE, MEDIA_TYPES } from "@/lib/media";
import { cn } from "@/lib/utils";
import { TOUCH_TARGETS } from "./touch";

/**
 * Resize an image to a MEDIA_SIZE square in the browser.
 * `cover` crops to the centre (profile pictures); `contain` fits it with transparent padding (logos).
 */
async function toSquare(file: File, fit: "cover" | "contain"): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MEDIA_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  const { width: w, height: h } = bitmap;
  if (fit === "cover") {
    const side = Math.min(w, h);
    ctx.drawImage(bitmap, (w - side) / 2, (h - side) / 2, side, side, 0, 0, MEDIA_SIZE, MEDIA_SIZE);
  } else {
    const scale = MEDIA_SIZE / Math.max(w, h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(bitmap, (MEDIA_SIZE - dw) / 2, (MEDIA_SIZE - dh) / 2, dw, dh);
  }
  bitmap.close();
  const encode = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await encode("image/webp", 0.9);
  // Browsers without a WebP encoder silently return PNG (or null): use PNG then.
  if (webp?.type === "image/webp") return webp;
  const png = await encode("image/png");
  if (!png) throw new Error("encode failed");
  return png;
}

export function ImageUpload({
  src,
  preview,
  upload,
  remove,
  fit,
  label,
  help,
  disabled,
}: {
  /** Current image URL, or null. */
  src: string | null;
  /** Renders the preview for a given image URL (null = initials). */
  preview: (src: string | null) => ReactNode;
  upload: (form: FormData) => Promise<ActionResult>;
  remove: () => Promise<ActionResult>;
  fit: "cover" | "contain";
  label: string;
  help: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [local, setLocal] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // The resized image stays as the preview after upload (identical to what the server stored),
  // so there is no flash while the new URL loads.
  useEffect(() => () => void (local && URL.revokeObjectURL(local)), [local]);

  const handle = (file: File | undefined) => {
    if (!file || disabled) return;
    if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) return void toast.error("Use a PNG, JPG or WebP image.");
    if (file.size > MAX_SOURCE_BYTES) return void toast.error("That image is too large. Use one under 2 MB.");
    start(async () => {
      let blob: Blob;
      try {
        blob = await toSquare(file, fit);
      } catch {
        toast.error("Couldn’t read that image. Try another file.");
        return;
      }
      setLocal(URL.createObjectURL(blob));
      const form = new FormData();
      form.set("file", new File([blob], blob.type === "image/webp" ? "image.webp" : "image.png", { type: blob.type }));
      const r = await upload(form);
      if (r.ok) toast.success(r.message ?? "Saved");
      else {
        toast.error(r.message ?? "Something went wrong");
        setLocal(null);
      }
      router.refresh();
    });
  };

  const clear = () =>
    start(async () => {
      setConfirmRemove(false);
      const r = await remove();
      if (r.ok) toast.success(r.message ?? "Removed");
      else toast.error(r.message ?? "Something went wrong");
      setLocal(null);
      router.refresh();
    });

  const shown = local ?? src;

  return (
    <div className="flex items-center gap-4 sm:gap-5">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files[0]);
        }}
        aria-label={shown ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        className={cn(
          "group relative shrink-0 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
          dragging && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        {preview(shown)}
        {!disabled ? (
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
              (pending || dragging) && "opacity-100",
            )}
          >
            {pending ? <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" /> : <ImageUpIcon className="size-5" />}
          </span>
        ) : null}
      </button>
      <div className="min-w-0 space-y-2">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="text-xs text-muted-foreground">{help}</p>
        </div>
        {!disabled ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
              {shown ? "Replace" : "Upload"}
            </Button>
            {src ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmRemove(true)} className="text-muted-foreground hover:text-destructive">
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={input}
          type="file"
          accept={MEDIA_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent className={`sm:max-w-sm ${TOUCH_TARGETS}`}>
          <DialogHeader className="pr-8">
            <DialogTitle className="text-balance">Remove {label.toLowerCase()}?</DialogTitle>
            <DialogDescription>It disappears for everyone straight away. You can upload a new one at any time.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={pending} onClick={clear}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
