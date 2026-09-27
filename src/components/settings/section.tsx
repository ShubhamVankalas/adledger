export function SettingsHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-balance">{title}</h2>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function ReadOnlyNotice({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
      Your role can view {what} but not change it. Ask an owner or admin if something needs updating.
    </p>
  );
}
