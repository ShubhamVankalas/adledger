"use client";

import { DownloadIcon, FileSpreadsheetIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { importRevenueCsvAction, importSpendCsvAction } from "@/app/actions/imports";
import { useFormAction } from "@/components/action-button";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Snippet } from "./code-snippet";

const PLATFORMS = [
  ["other", "Other / mixed (use a platform column)"],
  ["meta", "Meta"],
  ["google", "Google Ads"],
  ["microsoft", "Microsoft Ads"],
  ["tiktok", "TikTok"],
  ["linkedin", "LinkedIn"],
  ["pinterest", "Pinterest"],
  ["snapchat", "Snapchat"],
  ["reddit", "Reddit"],
  ["x", "X"],
];

export function ImportPanel({ origin, currency }: { origin: string; currency: string }) {
  const spend = useFormAction(importSpendCsvAction);
  const revenue = useFormAction(importRevenueCsvAction);
  return (
    <div className="grid grid-cols-1 gap-5 md:gap-6 @4xl/settings:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheetIcon className="size-4 text-muted-foreground" /> Ad spend CSV
          </CardTitle>
          <CardDescription>
            One row per ad (or campaign) per day. Columns: <code>date</code>, <code>campaign_name</code>, <code>spend</code> — optional <code>platform</code>, <code>ad_group_name</code>,{" "}
            <code>ad_name</code>, <code>currency</code>, <code>impressions</code>, <code>clicks</code>. Re-uploading the same day replaces it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={spend.submit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="spend-platform">Platform (if the file has no platform column)</Label>
              <NativeSelect id="spend-platform" name="platform" defaultValue="other">
                {PLATFORMS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Input name="file" type="file" accept=".csv,text/csv" required aria-label="Ad spend CSV file" className="cursor-pointer" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={spend.pending} className="max-md:flex-1">
                <UploadIcon /> Import spend
              </Button>
              <Button variant="outline" render={<a href="/api/v1/import/template?kind=spend" />}>
                <DownloadIcon /> Template
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheetIcon className="size-4 text-muted-foreground" /> Payments &amp; leads CSV
          </CardTitle>
          <CardDescription>
            Columns: <code>type</code> (payment, refund or lead), <code>external_id</code>, <code>amount</code>, <code>currency</code>, <code>occurred_at</code>, <code>email</code>. People are matched to
            their ad clicks by email. Amounts without a currency use {currency}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={revenue.submit} className="grid gap-3">
            <Input name="file" type="file" accept=".csv,text/csv" required aria-label="Payments and leads CSV file" className="cursor-pointer" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={revenue.pending} className="max-md:flex-1">
                <UploadIcon /> Import payments &amp; leads
              </Button>
              <Button variant="outline" render={<a href="/api/v1/import/template?kind=revenue" />}>
                <DownloadIcon /> Template
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="@4xl/settings:col-span-2">
        <CardHeader>
          <CardTitle>Automate it: Spend &amp; Conversions API</CardTitle>
          <CardDescription>
            Use an API key from{" "}
            <Link href="/settings/workspace/api" className="font-medium text-primary hover:underline">
              API &amp; MCP
            </Link>
            . Zapier and Make can call these with their Webhooks / HTTP steps, which covers hundreds of tools. Requests are idempotent: sending the same row or event again updates it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 @5xl/settings:grid-cols-2">
          <Snippet
              label="Send ad spend"
              code={`curl -X POST ${origin}/api/v1/spend \\
  -H "Authorization: Bearer al_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[{"platform":"other","account_name":"Taboola",
    "campaign_name":"Retargeting – US","ad_name":"Native A",
    "date":"2026-09-01","spend":"125.40","currency":"USD",
    "impressions":48210,"clicks":312}]}'`}
            />
          <Snippet
              label="Send a payment, refund or lead"
              code={`curl -X POST ${origin}/api/v1/conversions \\
  -H "Authorization: Bearer al_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"type":"payment","external_id":"order-1001",
    "amount":"249.00","currency":"USD","email":"jane@example.com",
    "visitor_id":"<adledger.getVisitorId()>","source":"shop"}]}'`}
            />
        </CardContent>
      </Card>
    </div>
  );
}
