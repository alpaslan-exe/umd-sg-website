# UM-Dearborn Student Government website

Static site for the Student Government of the University of Michigan-Dearborn.
Built with [Astro](https://astro.build), hosted on **GitHub Pages**, edited through
**Sveltia CMS** so board members can post news and update pages without touching code.

- Live site: https://alpaslan-exe.github.io/umd-sg-website/ (until moved to an org or custom domain)
- Editor: `/admin/` on the live site (link in the footer, "Editor login")

## How content works

Everything year-specific lives in content files, not in code:

| What | Where | Edit in CMS as |
|---|---|---|
| Office, hours, meeting time, contact email, socials, calendar ID, forms, announcement bar | `src/data/settings.json` | **Site Settings** |
| News posts | `src/content/posts/YYYY-MM-DD-slug.md` | **News** |
| Manual events (in addition to Google Calendar) | `src/content/events/` | **Events (manual)** |
| Executive board members, photos, emails, bios | `src/content/board/` | **Executive Board** |
| Senate committees and chairs | `src/content/committees/` | **Senate Committees** |
| Initiatives (SG Hears You, Charity 5K, ...) | `src/content/initiatives/` | **Initiatives** |
| Governing documents and resources | `src/content/documents/`, PDFs in `public/docs/` | **Documents** |
| Free services list | `src/content/services/` | **Services & Resources** |

Uploaded images go to `public/media/...` and are referenced as `/media/...`. The build
prefixes the base path automatically, including inside Markdown bodies.

Every save in the CMS is a Git commit on `main`, which triggers the deploy workflow.
The site is live about two minutes later.

## Handoff checklist (things only a human with the right accounts can do)

1. **Enable GitHub Pages** for this repo: Settings → Pages → Source: *GitHub Actions*. The
   workflow in `.github/workflows/deploy.yml` does the rest.
2. **CMS sign-in** (one-time, ~15 minutes, all free tiers). Board members sign in with a
   one-time code emailed to the board list `Dearbornsg.board@umich.edu`; no GitHub accounts or
   passwords. The authenticator lives in [`cms-auth/`](cms-auth/README.md) and runs on Cloudflare
   Workers. Follow that README: Cloudflare login, Brevo sender + API key, a bot GitHub token,
   `npm run deploy`, then set `backend.base_url` in `public/admin/config.yml`.
   Fallback until then: *Sign In Using Access Token* with a fine-grained PAT.
3. **Access control** = membership of the `Dearbornsg.board` MCommunity group. Anyone who can read
   that list can sign in, so keep it current at every turnover and rotate the bot token.
4. **Make the Google Calendar public.** In Google Calendar → the "UM-Dearborn Student Government"
   calendar → *Settings and sharing* → *Access permissions* → *Make available to public* (see
   all event details). Until then the embed shows a sign-in prompt and the "Next up" list is
   empty. The calendar ID lives in Site Settings.
5. **Board photos and emails.** Upload square headshots through *Executive Board* in the CMS.
   Only emails confirmed from official sources are filled in; add the rest.
6. **Confirm the General Meeting time** in Site Settings (currently "announced each semester").
7. **Charity 5K**: add date, route, and registration link on the initiative page when approved.
8. **Fix-It Form**: paste the current form link into the initiative page.
9. **Committee chairs** for this term: fill in *Chair* and *Chair email* on each committee.

## Moving to an org or custom domain

The site works as a project page (`owner.github.io/repo`) or at a root domain without code
changes. When you transfer the repo to an organization (GitHub → Settings → Transfer):

1. Set repository variables (Settings → Secrets and variables → Actions → Variables):
   `SITE_URL` (e.g. `https://umdsg.github.io` or `https://sg.umdearborn.edu`) and
   `BASE_PATH` (`/` for a root domain or `<org>.github.io` repo, otherwise `/<repo>`).
2. Update `backend.repo`, `site_url`, `display_url`, and `logo_url` in `public/admin/config.yml`.
3. Update `ALLOWED_DOMAINS` on the Cloudflare Worker.
4. For a custom domain, add it in Settings → Pages and enable *Enforce HTTPS*.

## Security notes

- No secrets in this repository. The Brevo key and GitHub bot token live only in the Cloudflare
  Worker. Tokens never touch the site; the CMS talks to the GitHub API directly from the browser.
- Publishing goes through a single bot token held only by the Cloudflare Worker; editors receive
  it after a one-time code. Codes expire in 10 minutes, are single use, and sending is rate limited.
  Trade-off accepted by SG: identity is "someone on the board list", so commits are not attributed to
  individuals. Rotate the token at turnover (`npm run secret:github` in `cms-auth/`).
- Sveltia CMS is pinned to an exact version with Subresource Integrity in
  `public/admin/index.html`. To upgrade, change the version and regenerate the hash:
  `curl -sL https://cdn.jsdelivr.net/npm/@sveltia/cms@<ver>/dist/sveltia-cms.js | openssl dgst -sha384 -binary | openssl base64 -A`
- The deploy workflow has minimal permissions (`contents: read`, `pages: write`, `id-token: write`).
- The site is fully static: no server, no database, no form handling. Contact goes through
  `mailto:` links and Google Forms.
- Optional: enable branch protection on `main` with "require pull request" and set
  `publish_mode: editorial_workflow` in `config.yml` so posts are reviewed before going live.

## Local development

Requires Node 22.12+ or 24 (LTS). Node 23/25 are not supported by Astro.

```bash
npm install
npm run dev        # http://localhost:4321/umd-sg-website/
npm run build      # static output in dist/
npm run preview
```

Set `SITE_URL` and `BASE_PATH` to build for a different location, e.g.
`BASE_PATH=/ SITE_URL=https://sg.example.edu npm run build`.

To edit content locally without GitHub sign-in, open `/admin/` on the dev server and
choose *Work with Local Repository* (Chrome or Edge).

## Calendar behaviour

- `/events` embeds the Google Calendar (agenda view) and lists the next events, fetched at
  build time from the calendar's public ICS feed. The workflow rebuilds daily at 06:00 Detroit
  so the list stays current; push to `main` or run the workflow manually to refresh sooner.
- Simple weekly/daily recurring events are expanded; complex recurrence rules show their first
  occurrence only. The embedded calendar is always complete.
- Events added under *Events (manual)* in the CMS are merged into the same list.

## Structure

```
src/
  components/   Header, Footer, cards, event list
  content/      Markdown content collections (edited by the CMS)
  data/         settings.json (site-wide settings singleton)
  layouts/      Base.astro (head, header, footer)
  lib/          calendar.ts (ICS fetch/parse), url.ts (base-path helper), format.ts
  pages/        one file per route
  styles/       global.css (design tokens: navy #00274C, maize #FFCB05, Georgia headings)
public/
  admin/        Sveltia CMS (index.html + config.yml)
  docs/         hosted PDFs (Statutes)
  img/          logo, OG image
  media/        CMS uploads
```
