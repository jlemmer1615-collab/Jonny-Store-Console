# Setup

No service key needs to be shared in chat. Configure values directly in GitHub and Supabase. Use a dedicated Supabase project when possible; these migrations add tables and access policies to `public` without modifying unrelated tables.

## 1. GitHub configuration

Set repository **Settings → Secrets and variables → Actions**. If you use the `supabase` deployment environment, its secrets can override repository secrets. Restrict that environment to `main` and add deployment protection if desired.

| Name | Store as | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Actions variable | `https://YOUR_PROJECT_REF.supabase.co` — public frontend and scheduler URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Actions variable | Public publishable key (or legacy **anon** key), never service-role |
| `SUPABASE_PROJECT_REF` | Actions variable | Supabase project reference |
| `SUPABASE_ACCESS_TOKEN` | Actions secret | Supabase personal access token for CLI deployment, **not** service-role |
| `SUPABASE_DB_PASSWORD` | Actions secret | Database password, used only when applying migrations |
| `CRON_SECRET` | Actions secret | Random secret shared only with the scheduler Edge Function |
| `ENABLE_PAGES_DEPLOY` | Actions variable | Start absent / `false`; set `true` to opt into Pages deployment |
| `ENABLE_STORE_SYNC` | Actions variable | Start absent / `false`; set `true` after eBay connection and manual sync succeed |

Generate the scheduler secret locally, for example with `openssl rand -hex 32`. Save the same value in GitHub and Supabase. Never commit the generated value.

## 2. Database and functions

After the code is on `main`, run **Actions → Deploy Supabase backend → Run workflow**, checking **Apply the reviewed database migrations** for first setup. The workflow applies `supabase/migrations/202611070001_console.sql` and deploys `console-api`, `ebay-callback`, and `scheduled-jobs`.

Alternatively, with the Supabase CLI locally:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --linked
supabase functions deploy --project-ref YOUR_PROJECT_REF
```

Do not run `db reset` against your existing project. On subsequent deployments, review each migration and apply it once. Function deployment does not itself connect eBay or enable automatic selling.

In **Supabase → Edge Functions → Secrets**, set:

| Secret | Value / meaning |
| --- | --- |
| `APP_URL` | Exact frontend URL including path and trailing slash; initially `https://jlemmer1615-collab.github.io/Jonny-Store-Console/` if using Pages |
| `EBAY_ENVIRONMENT` | `sandbox` initially; only literal `production` selects production |
| `EBAY_CLIENT_ID` | eBay client ID for the selected environment |
| `EBAY_CLIENT_SECRET` | Corresponding eBay client secret |
| `EBAY_RUNAME` | eBay Redirect URL Name (RuName), **not** the callback URL itself |
| `CRON_SECRET` | Same random secret as GitHub Actions |
| `LIVE_WRITES_ENABLED` | `false` initially; only literal `true` allows production writes |
| `EBAY_VERIFICATION_TOKEN` | 32–80 chars of `A-Za-z0-9_-`; must match the token entered in the eBay notification settings |
| `EBAY_DELETION_ENDPOINT` | Exact endpoint URL entered in eBay, e.g. `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ebay-deletion` |

Supabase automatically supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions. Do not add the service-role key to frontend variables or this repository. If you previously disclosed any privileged key, rotate it in its issuing service before use.

Before eBay approval you can set `APP_URL`, `CRON_SECRET` and `LIVE_WRITES_ENABLED=false`, deploy, configure login and create product drafts. Leave sync disabled. The eBay connection reports that developer configuration is pending.

`verify_jwt=false` is intentional: `console-api` verifies the user using Supabase Auth's `getUser` and then the operator allowlist; `scheduled-jobs` validates the dedicated secret; `ebay-callback` consumes a single-use expiring state. None accepts unauthenticated seller operations.

## 3. Your operator account

1. In Supabase **Authentication → Providers → Email**, enable email/password. Disable **Allow new users to sign up**. Use a strong password for the invited operator.
2. Invite/create your user in **Authentication → Users** and complete confirmation / set the password. This console has no public signup or password-reset flow; manage recovery through Supabase's user invitation/reset tools.
3. Copy its UUID, then run this in the SQL editor with the real UUID:

```sql
insert into public.console_operators(user_id)
values ('YOUR_AUTH_USER_UUID'::uuid)
on conflict do nothing;
```

4. Allowlist only your account. A valid login alone grants no console access. There is no automatic “first user becomes admin” behavior.
5. Set Supabase Auth's **Site URL** and allowed redirect URL to your exact frontend URL. This password-based login does not require OAuth social-provider setup.

## 4. Static frontend

Review [GitHub Pages' usage limits and terms](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), including commercial-use restrictions, before enabling it for a seller business. If your intended use is not permitted, host `dist/` on a suitable static host instead; use `/` for `BASE_PATH` and update `APP_URL` and Auth URLs.

For Pages:

1. **Repository Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Set the public Supabase variables from step 1. Without them, deployment intentionally shows sample data in demo mode.
3. Set `ENABLE_PAGES_DEPLOY=true` and run **Deploy console to Pages** from `main`.
4. The expected project URL is `https://jlemmer1615-collab.github.io/Jonny-Store-Console/`; use the actual URL from the deployment run. Assets are built with the repository path.
5. Sign in with the invited operator account. The static source is public; actual seller data is protected by Auth, RLS, and Edge Function authorization.

Only allow eBay-hosted images in the dashboard CSP by default. Product records can retain supplier image URLs for publication, but the UI uses its own product artwork rather than fetching arbitrary supplier URLs. If using a custom Supabase domain, update the CSP and public config validator deliberately.

## 5. eBay after developer approval

1. Create sandbox application keys and a sandbox seller/test buyer. The initial implementation supports US marketplace listings and USD updates.
2. In eBay's application redirect configuration, register the **accepted / declined authorization callback**:

   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/ebay-callback`

   Set your application privacy policy / consent information as required by eBay. Copy the resulting **RuName** into `EBAY_RUNAME`. The callback is a backend endpoint; do not use a GitHub Pages route as the eBay token exchange endpoint.
3. The authorization request asks for base `api_scope`, `sell.inventory`, `sell.fulfillment`, and `sell.analytics.readonly`. Ensure the application is eligible for each. Missing permissions fail visibly instead of inventing data.
4. In the console, use **Settings → Connect eBay** and authorize. State expires after ten minutes and can only be used once. Authorize the intended seller; this private app assumes you connect your own account.
5. Click **Sync store**. Existing listings, orders, buyer offers and traffic load where the environment/API permits. Analytics data may be unavailable in sandbox.
6. Before publishing new inventory, set up eBay business policies and an Inventory API merchant location. Add their IDs/key, category ID, HTTPS image, plain-text description and required category-specific item specifics to the product draft. Verify stock/cost and choose an eligible sourcing model.
7. Queue an action, approve it, and execute it. Check the result in eBay. Complete the sandbox checklist in [TESTING.md](TESTING.md).
8. Handle eBay's required production application review, privacy disclosures and marketplace account-deletion notification setup. The `ebay-deletion` function implements the endpoint; see the next section for how to subscribe it.

### Marketplace account deletion endpoint

eBay requires every production application to either subscribe to deletion notifications or, only if it persists no eBay data, opt out. This console stores listings, orders, buyer offers and OAuth tokens, so the exemption does not apply — subscribe instead.

1. Deploy the backend, then confirm the endpoint answers a challenge. Replace the values with your own:
```sh
curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/ebay-deletion?challenge_code=test"
```
It returns `{"challengeResponse":"…"}`, the SHA-256 of `challengeCode + verificationToken + endpoint` in that exact order.
2. In the eBay developer portal, open **Application Keys → Notifications** for the production keyset, choose **Marketplace Account Deletion**, and save the alert email.
3. Set the notification endpoint to the same URL used above and the verification token to `EBAY_VERIFICATION_TOKEN`. eBay sends the challenge immediately, so the function must already be deployed and configured.
4. Use **Send Test Notification** to confirm delivery.

Security properties of the implementation: the endpoint answers a POST only when `X-EBAY-SIGNATURE` verifies against the key fetched from eBay's Notification API, and it returns `412` otherwise, so it cannot be used as an unauthenticated delete request. Public keys are cached for an hour. Deletion is idempotent — a repeated notification for already-deleted data returns `200`.

The eBay user id is captured at OAuth connect time (`ebay_credentials.ebay_user_id`), because eBay's notification identifies a user by that id while the schema otherwise keys on the Supabase auth UUID. If an account was connected before this column existed, reconnect it so the id is stored; otherwise a notification for that user cannot be matched.

Deletion removes the owner's product, listing, offer, order, traffic, queue and settings rows plus the eBay credentials (which also drops the stored tokens). It deliberately keeps the Supabase login and the `console_operators` row, which are our own identity records rather than eBay data, so the operator can sign in and reconnect.



Keep scheduled sync disabled during the switch. Replace all eBay application values with production values, set `EBAY_ENVIRONMENT=production`, and reconnect the production seller. Use a separate Supabase project for production so sandbox listings/orders cannot mix with live data. If reusing a project, archive/reset seller tables and credentials deliberately before the switch; the app does not migrate sandbox data to production.

Sync and inspect production data while `LIVE_WRITES_ENABLED=false`. When sandbox testing, policies, supplier arrangements and approval behavior are verified, set `LIVE_WRITES_ENABLED=true` in Supabase secrets if you want production mutations. Keep **Require my approval** enabled initially. Authorization lets the app act as your seller; do not authorize an account you do not control.

## 6. Scheduled sync and actions

Set `ENABLE_STORE_SYNC=true` only after a manual sync succeeds. The GitHub workflow invokes `scheduled-jobs` at minutes 7 and 37 each hour. GitHub schedules can be delayed, and public repository schedules can be disabled after inactivity. Use manual dispatch and inspect both workflow results and console Activity when troubleshooting.

- Sync runs regardless of the in-app **Enable automated actions** preference.
- With automated actions off (default), scheduled runs only read eBay data.
- With automation on and approval on (default), verified product data can propose price/stock changes. Only individually approved actions execute.
- With automation on and approval off, eligible proposals and explicitly queued drafts/tracking can be approved automatically. Changes above 25% still require review.
- No price/stock proposals are generated from stale (>6h), missing, or ineligible supplier data. This is **not continuous supplier monitoring** until a real supplier feed is added.
- At most three approved actions execute per run to bound Edge Function time. Uncertain writes never automatically retry. Check eBay and reconcile them manually.

To stop new scheduled changes, disable `ENABLE_STORE_SYNC` and the in-app automation setting. To immediately block production mutations at the server, set `LIVE_WRITES_ENABLED=false`. These gates do not undo an already submitted eBay request.
