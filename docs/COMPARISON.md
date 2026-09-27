# AdLedger compared with Hyros, Triple Whale, Cometly and Northbeam

All five tools try to answer the same question: which ads actually made money. The hosted tools do
it as a service you pay for and send your data to. AdLedger does it as software you run yourself.
This page compares them only on things we can state with confidence, and is explicit about what
AdLedger doesn't do.

> Competitor details as publicly listed in 2026; check their sites for current pricing and
> features. We don't quote competitor prices here, because they change and often depend on your
> revenue or order volume. If something below is out of date, please
> [open an issue](https://github.com/ShubhamVankalas/adledger/issues).

## At a glance

|   | **AdLedger** | Hyros | Triple Whale | Cometly | Northbeam |
|---|---|---|---|---|---|
| Price | **Free** | Paid plans | Paid plans | Paid plans | Paid plans |
| Licence | **Open source (AGPL-3.0)** | Proprietary | Proprietary | Proprietary | Proprietary |
| Where it runs | **Your server** (Docker, a VPS, Render, Railway…) | Vendor cloud | Vendor cloud | Vendor cloud | Vendor cloud |
| Who holds the data | **You** (your PostgreSQL) | Vendor | Vendor | Vendor | Vendor |
| Code you can audit | **Yes** | No | No | No | No |
| Use a local AI model (Ollama, LM Studio) | **Yes**, or any cloud model, or none | No | No | No | No |
| MCP server on your own infrastructure | **Yes**, 14 read-only tools | No | No | No | No |
| Seats, workspaces and client logins | **Unlimited** | Check plan | Check plan | Check plan | Check plan |
| White-label PDF reports | **Included** | Check plan | Check plan | Check plan | Check plan |
| Security controls (2FA, audit log, roles, masking) | **Included, free** | Check plan | Check plan | Check plan | Check plan |

"No" in the rows about running on your server, local models and self-hosted MCP follows from these
tools being hosted services: your data lives in their cloud, so it can't be processed by a model on
your own machine or served from your own infrastructure.

## Where AdLedger is different

**You own the install.** AdLedger is one container plus PostgreSQL. No telemetry, no licence
server, no AdLedger account. The only outbound calls are the integrations you switch on. When you
self-host, you are the data controller, which also means you are responsible for running it well
(see [SECURITY.md](SECURITY.md#7-operator-hardening-checklist)).

**Free means free.** No per-seat pricing, no share of revenue tracked, no premium tier for 2FA, the
audit log, email masking, white-label reports or client logins. You pay only for the server (about
1 GB of RAM).

**Numbers you can check.** Every figure is computed in SQL from the ledger, money is stored in
integer minor units, and split credit always adds up to the payment. PDF reports carry a fingerprint
anyone can check at `/verify` on your install, and the audit log is hash-chained. The AI (if you use
one) only writes words; numbers it invents are flagged.

**Features built around cash, not clicks.**

- **Ad Receipts**: for every payment, which ads earned it, what the customer cost and when they paid
  it back, reconciled to total spend.
- **Truth Gap**: what each platform claims against what your payments show.
- **Profit Ledger**: POAS and profit after ads from your cost of goods, fees and shipping, and which
  ads bring buyers who refund.
- **Too-early guardrails**: per-campaign time to money, so you don't kill an ad whose buyers haven't
  paid yet, plus pause drafts you import yourself.
- **A CRM in the same ledger**: contacts, pipeline, notes and tasks where every lead shows what it
  cost.

**AI on your terms.** Local Ollama or LM Studio, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek or
any OpenAI-compatible endpoint, or no model at all. The built-in MCP server lets Claude, Cursor and
other assistants query your ledger read-only.

## What AdLedger doesn't do (yet)

Being honest about gaps matters more than a longer feature list.

| Area | AdLedger today |
|---|---|
| **Attribution models** | First touch, last touch and linear. No data-driven, time-decay or position-based model yet. |
| **View-through and modelled conversions** | AdLedger counts clicks it can see. It doesn't estimate views or model conversions it can't observe (the Truth Gap page shows the platforms' own claims next to yours). |
| **Media mix modelling** | Not included. |
| **Connector maturity** | Meta, Google Ads and Stripe are the most mature connectors. The other ad platforms, payment tools and the conversion uploads are in beta: tested against real-format fixtures, not yet verified on live accounts. |
| **Writing to ad platforms** | AdLedger never changes budgets or pauses ads. It gives you pause drafts to import yourself. |
| **Call tracking, email sequences, a shared inbox** | Not included. |
| **A hosted version** | None. You run it; there is no support contract. |
| **Certifications** | None. AdLedger ships controls that map to common SOC 2 criteria, but the project isn't audited, and a self-hosted install is yours to run and assess. |

## Choosing

- **Pick AdLedger** if you want the core attribution and revenue ledger without a monthly bill,
  need your customer data to stay on infrastructure you control, run an agency with many client
  workspaces, or want to use a local AI model or your own AI assistant on the data.
- **Pick a hosted tool** if you want someone else to run and support it, need data-driven or
  view-through attribution today, or prefer a managed onboarding.

See [FEATURES.md](FEATURES.md) for everything AdLedger includes and [ROADMAP.md](ROADMAP.md) for
what's next.
