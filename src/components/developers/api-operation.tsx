"use client";

import { ChevronRightIcon } from "lucide-react";
import { Snippet } from "@/components/settings/code-snippet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RefOperation } from "@/lib/api-reference";
import { cn } from "@/lib/utils";

const METHOD_TONE: Record<string, string> = {
  GET: "bg-brand-soft text-brand-foreground",
  POST: "bg-info/12 text-info",
  DELETE: "bg-negative-soft text-negative",
};

/** `code` spans from the spec's markdown-ish descriptions. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} translate="no" className="rounded-xs bg-fill px-1 font-mono text-[0.92em] text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** One endpoint: a disclosure row with parameters and copyable curl / JavaScript / Python. */
export function ApiOperation({ op }: { op: RefOperation }) {
  return (
    <details id={op.id} className="group/op scroll-mt-24">
      <summary className="grid cursor-pointer list-none grid-cols-[1rem_3.75rem_minmax(0,1fr)] items-center gap-3 px-4 py-3 outline-none hover:bg-fill/60 focus-visible:bg-fill/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[1rem_3.75rem_minmax(0,22rem)_minmax(0,1fr)] [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-4 text-fg-faint transition-transform group-open/op:rotate-90 motion-reduce:transition-none" />
        <span className={cn("inline-flex h-5 w-fit items-center rounded-sm px-1.5 font-mono text-micro font-semibold", METHOD_TONE[op.method] ?? "bg-fill text-muted-foreground")}>{op.method}</span>
        <code translate="no" className="min-w-0 truncate font-mono text-mono text-foreground">
          {op.path}
        </code>
        <span className="col-start-3 truncate text-ui text-muted-foreground md:col-start-auto">{op.summary}</span>
      </summary>
      <div className="grid gap-4 border-t bg-bg-subtle/60 px-4 py-4 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          {op.description ? (
            <p className="text-ui text-pretty text-muted-foreground">
              <Inline text={op.description} />
            </p>
          ) : null}
          {op.params.length ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-left text-ui">
                <caption className="sr-only">Parameters</caption>
                <thead className="border-b text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Parameter
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {op.params.map((p) => (
                    <tr key={`${p.in}-${p.name}`} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <code translate="no" className="font-mono text-mono text-foreground">
                          {p.name}
                        </code>
                        <span className="block text-caption text-muted-foreground">
                          {p.in}
                          {p.required ? " · required" : ""}
                        </span>
                      </td>
                      <td className="max-w-40 px-3 py-2 font-mono text-caption break-words text-muted-foreground">{p.type}</td>
                      <td className="min-w-48 px-3 py-2 text-caption text-pretty text-muted-foreground">
                        <Inline text={p.description} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        <Tabs defaultValue="curl" className="min-w-0">
          <TabsList aria-label="Example language">
            <TabsTrigger value="curl" className="flex-none px-2.5">
              curl
            </TabsTrigger>
            <TabsTrigger value="js" className="flex-none px-2.5">
              JavaScript
            </TabsTrigger>
            <TabsTrigger value="python" className="flex-none px-2.5">
              Python
            </TabsTrigger>
          </TabsList>
          <TabsContent value="curl" className="pt-2">
            <Snippet label="Terminal" code={op.examples.curl} />
          </TabsContent>
          <TabsContent value="js" className="pt-2">
            <Snippet label="Node 18+ / browser" code={op.examples.js} />
          </TabsContent>
          <TabsContent value="python" className="pt-2">
            <Snippet label="Python (requests)" code={op.examples.python} />
          </TabsContent>
        </Tabs>
      </div>
    </details>
  );
}
