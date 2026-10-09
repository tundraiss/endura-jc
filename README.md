# ENDURA JC Cloud — GitHub Pages + Supabase

## Setup
1. In Supabase > SQL Editor, run `schema.sql` once on a NEW project. Do not rerun blindly after changing policies.
2. Supabase > Authentication > Users > Add user. Copy the new user's UUID (not their email).
3. SQL Editor, run `insert into public.staff (user_id,display_name) values ('YOUR-USER-UUID','Office Admin');` replacing the UUID. Do not expose the UUID as a password.
4. In Supabase > Authentication > URL Configuration, set Site URL to `https://tundraiss.github.io/endura-jc/` and add the same Redirect URL if using email authentication flows.
5. In `config.js`, paste Supabase Project URL and **publishable** key only.
6. In GitHub `tundraiss/endura-jc`, back up the old version, then upload `index.html`, `app.js`, `config.js`, `manifest.webmanifest`, `icon.svg` into the repository **root**. `schema.sql` can stay on your PC; it is not required by the website. Remove or update the previous service worker (`sw.js`) if it caches old pages.
7. Wait for GitHub Pages to deploy, open the site, sign in, create a test job, then open on iPhone using the same login.

## Limitations / safety
- This is a NEW cloud-enabled replacement for the previous local-only prototype, not a migration of browser localStorage. Export/retain old records before replacing.
- Only staff UUIDs inserted by a Supabase project administrator can access data. All tables and the private invoice bucket use RLS. Staff share access to all company jobs.
- Invoice PDFs are private, max 10 MB; viewing uses a short-lived signed URL.
- Automatic WhatsApp sending is **NOT implemented**. Ready-for-collection creates a `pending_integration` record; approved delays are also **NOT sent**. A secure backend, Meta credentials, customer consent and approved templates are required later.
- Delay drafts are created when the app is opened/refreshed, not by a scheduled background process yet.
- Job numbers must be unique. Job/item editing, deleting, live subscriptions, offline mode, migration and production monitoring are not implemented.
- Do not store service-role keys or Meta API tokens in `config.js` or GitHub.
