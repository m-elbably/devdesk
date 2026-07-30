# Self-hosting the sync API

DevDesk works fully offline. Sync is opt-in: one Cloudflare Worker and one D1 database,
which sits comfortably inside Cloudflare's free tier for personal use. There is no hosted
DevDesk server — you run your own.

`wrangler` is a dev dependency of the workspace, so nothing needs installing globally; every
command below runs from the repo root.

## Users and roles

Accounts live on the sync server, not on the device — they only matter once you sync. Each user is
either an **admin** or a **user**.

- The **single admin** is provisioned from `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` on
  the first login attempt, and only if no admin exists yet. Leaving them unset disables seeding.
- Exactly one admin is possible: a partial unique index (`users(role) WHERE role = 'admin'`)
  enforces it in the database, not in application code. Admin-created accounts are always `user`.
- There is **no self-serve signup**. An unknown email is rejected — every account after the admin
  is created from **Administration → Users**.

Signed in as the admin, the sidebar gains an **Administration → Users** section: a table of every
account, with *Add user*, *Edit name* and *Reset password*. The UI hides the section for non-admins
and the API independently returns `403` on `/api/admin/*`, so hiding it is cosmetic rather than the
security boundary.

## Running it locally

`wrangler dev` simulates D1 on disk under `apps/sync-api/.wrangler/`, so no Cloudflare account is
needed to test sync.

Local admin credentials go in `apps/sync-api/.env` (see `.env.example`; the file is gitignored):

```
DEFAULT_ADMIN_USERNAME=admin@example.com
DEFAULT_ADMIN_PASSWORD=change-me-at-least-8-chars
```

`pnpm dev:api` copies it to `.dev.vars` so wrangler exposes both as worker bindings.

```bash
pnpm dev:api:migrate   # create/migrate the local D1 (once)
pnpm dev:api           # serve the API on http://localhost:8787
pnpm dev               # or: API + desktop dev server together
```

Then open **Settings → Cloud sync**, set the server URL to `http://localhost:8787`, and sign in with
the `DEFAULT_ADMIN_*` credentials — that first attempt creates the admin account. Inspect the local
database with:

```bash
pnpm --filter @devdesk/sync-api exec wrangler d1 execute devdesk --local --command "SELECT * FROM tasks"
```

## Deploying to Cloudflare

**1. Log in to Cloudflare** (a free account is enough):

```bash
pnpm --filter @devdesk/sync-api exec wrangler login
```

**2. Create the D1 database.** Copy the `database_id` it prints into `apps/sync-api/wrangler.toml`,
replacing `REPLACE_WITH_D1_DATABASE_ID`:

```bash
pnpm --filter @devdesk/sync-api exec wrangler d1 create devdesk
```

**3. Create the tables** on the remote database (`migrations/` is applied in order):

```bash
pnpm --filter @devdesk/sync-api db:migrate:remote
```

**4. Set a real `JWT_SECRET`.** First delete the `JWT_SECRET` line from the `[vars]` block in
`wrangler.toml` — it is a local-dev placeholder, and a plain-text var beats a secret of the same
name when you deploy. Keep local dev working by putting the value in `apps/sync-api/.env` (which
`pnpm dev:api` copies to `.dev.vars`), then set the production one as a secret:

```bash
pnpm --filter @devdesk/sync-api exec wrangler secret put JWT_SECRET
```

Use something long and random — the app's Token Generator is right there. It signs every login
token, so changing it later signs everyone out.

**5. Seed the admin account.** Two more secrets, read only on the first login attempt and only if
no admin exists yet:

```bash
pnpm --filter @devdesk/sync-api exec wrangler secret put DEFAULT_ADMIN_USERNAME
pnpm --filter @devdesk/sync-api exec wrangler secret put DEFAULT_ADMIN_PASSWORD  # 8+ chars
```

**6. Deploy.** Wrangler prints the URL — the subdomain comes from `name` in `wrangler.toml`:

```bash
pnpm --filter @devdesk/sync-api run deploy
curl https://devdesk-sync-api.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"devdesk-sync-api"}
```

**7. Point the app at it.** Open **Settings → Cloud sync**, set the server URL to that `https://`
address, and sign in with the `DEFAULT_ADMIN_*` credentials — that first login creates the admin
account. Everyone else gets an account from **Administration → Users**; there is no self-serve
signup.

**8. Optional tidy-up.** Once the admin row exists its password is stored hashed in D1, so the seed
secrets are dead weight:

```bash
pnpm --filter @devdesk/sync-api exec wrangler secret delete DEFAULT_ADMIN_PASSWORD
```

## Worth knowing

- **Custom domain:** Cloudflare dashboard → Workers & Pages → your worker → Settings → Domains & Routes.
- **CORS is wide open** (`app.use('*', cors())` in `src/index.ts`) — the API is gated by JWT, not by
  origin. Narrow it there if you want a second lock.
- **Login tokens last 30 days**, then the app asks for the password again.
- **Migrating later:** add a file to `apps/sync-api/migrations/` and re-run step 3.

The server URL is configured per-install in **Settings → Cloud sync** and stored in `localStorage`.
It must be `https://` — plain `http://` is accepted only for `localhost` and `127.0.0.1` so the local
dev server above works. `VITE_SYNC_API_URL` sets the default for a fresh install (falls back to
`http://localhost:8787`). Changing the URL signs you out, since the token and sync cursor belong to
the previous server.
