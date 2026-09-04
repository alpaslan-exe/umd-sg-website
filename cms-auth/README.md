# umdsg-cms-auth

Cloudflare Worker that signs board members into the website editor (Sveltia CMS) with a
one-time code emailed to the board mailing list. No GitHub accounts or passwords for editors.

## One-time setup (~15 min, free tier everywhere)

1. **Cloudflare account** (free): https://dash.cloudflare.com/sign-up
2. **Brevo account** (free, 300 emails/day): https://www.brevo.com. Under *Senders*, add and
   verify `Dearbornsg.board@umich.edu` (Brevo emails a verification link to the list; anyone on
   the list can click it). Create an API key under *SMTP & API → API keys*.
3. **GitHub bot token**: create a GitHub account for SG (e.g. `umdsg-bot`, with 2FA), add it as a
   collaborator with *Write* on the site repo, then make a fine-grained personal access token:
   Settings → Developer settings → Fine-grained tokens → repository access: only the site repo →
   permissions: *Contents: Read and write* (Metadata is added automatically). Expiration: 1 year.
   Put the renewal date on the SG calendar.
4. From this folder:

   ```bash
   npm install
   npx wrangler login              # opens the browser once
   npm run setup                   # prints a KV namespace id; paste it into wrangler.toml
   npm run secret:brevo            # paste the Brevo API key
   npm run secret:github           # paste the bot token
   npm run deploy                  # prints https://umdsg-cms-auth.<account>.workers.dev
   ```

5. In `public/admin/config.yml` set `backend.base_url` to that URL and commit. Done: the
   "Sign in with GitHub" button on `/admin/` now opens the code screen instead.

## Operating notes

- Codes: 6 digits, 10-minute expiry, 5 attempts, single use. Sending is limited to 5 per IP per
  10 minutes and 40 per hour overall.
- Every send and successful sign-in is logged; view with `npm run tail`.
- Anyone who can read the board list can sign in. Remove people from the MCommunity group when they
  leave the board, and rotate the bot token (`npm run secret:github`) at turnover.
- Change `ALLOWED_DOMAINS` in `wrangler.toml` if the site moves to a new hostname.
