# Jin's Dining (data mirror)

A nightly snapshot of my restaurant list, exported from Supabase. Two files are
regenerated each night and committed here, so the git history is a running
backup of the list over time:

- **`dining.md`** — readable, curated list (favourites, Singapore by area,
  overseas by city, want-to-try, top rated). This is what chat assistants
  (Claude, ChatGPT) read.
- **`dining.json`** — the same data, structured, for precise/programmatic use.

This mirrors the cellar pipeline (`jins-cellar-data`): same auth model, same
REST-API read, same commit-back GitHub Action — only the data source and the
output format differ.

## What gets exported

`export-dining.mjs` fetches **only** these whitelisted columns from the
`restaurants` table:

```
name, cuisine, country, city, area, rating, status,
michelin_type, michelin_stars, michelin_verified,
google_rating, price_level, favourite
```

The private `notes` column and all internal/heavy columns (ids, photo URLs,
timestamps, enrichment flags) are **never requested**, so they cannot appear in
the public files. The summary line (`X visited · Y to try · Z avg · N total`)
is computed live from the fetched rows on every run — nothing is hardcoded.

## ⚠️ Required first step — manual, watched run

**Do NOT wait for the nightly cron on first setup.** The very first export must
be a manual run you watch, so we can verify the live (snake_case) schema and the
output format *before* anything relies on `dining.md`:

1. Finish setup (create repo + add secrets, below).
2. Go to the **Actions** tab → open *Refresh dining export* → click
   **Run workflow** (this is the `workflow_dispatch` trigger).
3. Watch the run. If it fails on a missing/renamed column, the Supabase schema
   differs from the expected column names above — fix `COLUMNS` in
   `export-dining.mjs` and re-run.
4. Open the committed `dining.md` and confirm the sections, markers (★ / ♥ /
   `[closed]`), and counts look right.
5. Only once that run is verified should the nightly cron be relied upon. The
   cron (`0 18 * * *` = 02:00 SGT) will then keep it fresh automatically.

## One-time setup

1. Create this repo on GitHub as **`jins-dining-data`** (public, so chats can
   read the raw file with no auth).
2. Add the script, the workflow, and this README (drag-and-drop upload is fine).
3. In **Settings → Secrets and variables → Actions**, add two repository secrets:
   - `SUPABASE_URL` = `https://dunebdadsixnpufqnsss.supabase.co`
   - `SUPABASE_KEY` = the dining project's Supabase **publishable** key
     (read-only; not sensitive).
4. Do the **Required first step** above (manual Run workflow + verify).
5. (Optional) Mirror to your computer: clone the repo or add it in GitHub
   Desktop for a local copy.

## The raw URL (for chats)

After the first verified run, the readable file is at:

```
https://raw.githubusercontent.com/yungjinchew/jins-dining-data/main/dining.md
```
