import { createCn } from "cn/config"

// Class merging that knows the Quiet Ledger scale in globals.css: `text-ui`, `text-caption`… are
// font sizes (not colours), so they never knock out a `text-primary-foreground` next to them, and
// `shadow-hairline` is a shadow.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "caption", "ui", "body", "title-sm", "title", "kpi", "kpi-lg", "mono"] }],
      shadow: [{ shadow: ["hairline"] }],
    },
  },
})
