# T4 website deployment plan — Signhify CLI

Status: **executable now**. The repo ships a static site (`site/`) with zero
build framework — vercel.json pins `outputDirectory: "site"`, `cleanUrls`
rewrites `/docs/:name` to `/docs/:name.md`, and immutable caching covers
`/assets/*` (banners/logos/og-images).

## Option A — Vercel (current OG target)

The site's canonical URL (`og:url`) already points at
`https://signhify-cli.vercel.app`, so Vercel is the primary target.

```bash
# one-time link (creates the signhify-cli project)
npx vercel link --project signhify-cli

# deploy the static site exactly as configured
npx vercel deploy --prod
```

`vercel.json` at the repo root drives everything: no framework detection, no
build step. After editing `docs/*.md`, run `npm run build:docs` to refresh
`site/docs/` (or wire it into the Vercel Build Command as
`npm run build:docs` — takes <1s and needs only Node).

## Option B — Cloudflare Pages (zero-cost alternative)

```bash
npx wrangler pages deploy site --project-name signhify-cli
```

Same directory, same static behavior. CF Pages ignores `vercel.json`, so the
rewrite for `/docs/:name` Markdown routes is a Vercel-only nicety —
Cloudflare Pages serves `/docs/<name>.md` directly (raw markdown in browser).
Add `docs/_headers` only if cache tuning is wanted; not required today.

## What must be true at deploy time (consistency)

1. Comparison table cells provable from the shipped CLI commit — T4.1 audit
   landed: MCP section says stdio only (client is stdio-transport only), and
   the router row claims the bundled health-checked chain instead of
   overstated "auto-discovery".
2. Terminal preview component (`packages/web/src/components/TerminalPreview.ts`
   + fixture) shipped and test-asserted (3/3 vitest) before the site references
   any preview markup.
3. `npm run build && npm test` green on the commit deployed.

## Runtime cost

Vercel Hobby / Cloudflare Workers free tiers both comfortably serve the
static site. No function invocations are required for the site surface
itself.
