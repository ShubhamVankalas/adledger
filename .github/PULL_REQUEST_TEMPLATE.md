## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". Large or risky change? It should have been discussed in an issue first. -->

## Type of change

<!-- Keep the one that fits. The PR title must be a conventional commit: feat: / fix: / docs: / refactor: / perf: / test: / build: / ci: / chore: -->

- [ ] Bug fix (`fix`)
- [ ] New feature (`feat`)
- [ ] New integration or connector (ad platform, revenue source, notification channel)
- [ ] Breaking change (`!`; explain the migration path below)
- [ ] Refactor or performance (no behaviour change)
- [ ] Documentation only
- [ ] Tests, CI or tooling

## How it was tested

<!-- Commands you ran and what you checked by hand. Connectors: mock mode is enough. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Tests added or updated (a bug fix has a test that fails without the fix)
- [ ] Docs updated where behaviour changed (`docs/`, `.env.example`, `docs/ROADMAP.md`)
- [ ] Schema changed: I ran `pnpm db:generate` and committed the new file in `drizzle/` (or: no schema change)
- [ ] UI changed: screenshots attached below, and it works on a phone-width screen (or: no UI change)
- [ ] No secrets, tokens or real customer data in the code, fixtures, logs or screenshots
- [ ] Every commit is signed off (`git commit -s`; see CONTRIBUTING.md, the DCO check enforces it)

### Project rules (tick any that apply, confirm you kept them)

- [ ] Money is integer minor units plus a currency; no floats
- [ ] New tenant tables have `workspace_id`
- [ ] Server actions start with `guard(permission)` and call `audit()`
- [ ] Raw email only in `contacts`; elsewhere SHA-256; nothing sensitive is logged
- [ ] No new service or container, and any new env var is optional and documented
- [ ] No new outbound network calls or dependencies (or: justified below)

## Screenshots

<!-- UI changes: before and after, light and dark if relevant. Blur anything private. -->

## Notes for the reviewer

<!-- Trade-offs, follow-ups, anything unusual. New dependency? Say what it does, why it's needed, its licence. -->
