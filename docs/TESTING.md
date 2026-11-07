# Validation and sandbox acceptance

## Automated checks

- `npm run build`: public-config validation, strict frontend TypeScript, production bundle.
- `npm run check:edge`: checks all three Deno Edge Function entry points against the installed, pinned npm packages.
- `npm test`: pricing/margin math; eligible sourcing; expired/future stock verification; expired offers; traffic snapshots; CSV quoting; real Postgres-compatible migration, RLS, blocked browser writes and token reads, operator isolation, job lock and action claim behavior (PGlite).
- `npm run test:dom`: application interaction tests for listing filters, theme persistence, draft creation, screen navigation, saved settings and approval/execution, without a native browser.
- `npm run test:ui`: Playwright desktop/mobile navigation, search, low-stock filtering, persistent theme, product creation, settings, approval/execution simulation, dialog fit and browser errors. These run in demo mode without credentials.

The CI workflow runs these checks. They do **not** verify a deployed Supabase project or live eBay/supplier credentials.

## Sandbox acceptance checklist

Use a dedicated sandbox project and eBay test seller. Do not enable production writes while doing this.

1. **Access:** signed-out function calls receive 401; another signed-in Auth user receives 403; neither can read listings or credential tables. The operator can read only its seller tables and cannot mutate them directly.
2. **OAuth:** a valid flow returns to `APP_URL`; a missing, altered, expired or replayed state fails. Refresh tokens never appear in frontend responses or logs. Refresh a token near expiry and check a subsequent sync.
3. **Sync:** compare listing IDs/counts, remaining quantities, sold quantities and watchers against Seller Hub. Include several pages of fixtures. Verify externally ended listings are archived only after complete listing pagination succeeds. Verify app-created Inventory listings retain their offer mappings on sync.
4. **Offers:** create a buyer Best Offer and check title, amount, currency, expiry and quantity. Expired or inactive offers stop counting. Missing API permission retains prior data with a warning.
5. **Traffic:** in an environment with Analytics access, compare daily views and a listing's 30-day total with Seller Hub for the same date range/timezone. Sync twice and confirm totals do not double. Yesterday is the final date of the requested daily report; current-day data is incomplete by design.
6. **Publication:** create an eligible complete product with a unique SKU, category-specific item specifics and policy IDs. Verify stock/cost, queue, approve, execute, and inspect the listing in eBay. A research product, stale snapshot, missing required field, changed draft, insufficient margin, or empty stock must fail closed.
7. **Revisions:** test both an app-created Inventory listing and a single-SKU fixed-price Trading listing. Check price/stock and run the same action twice. Only one remote action may execute. A remote change after approval must require fresh review; variations and non-USD revisions are unsupported.
8. **Shipping:** test a paid, wholly unfulfilled order. Queue valid carrier/tracking, approve, execute and inspect eBay. A paid status change, prior fulfillment or partial shipment must stop the action. Verify no duplicate fulfillment is created.
9. **Failure handling:** simulate an upstream timeout after sending a publish/shipment. The action becomes `needs_review` and is not retried. Reconcile eBay's actual result before closing the review and creating another action.
10. **Scheduler:** wrong/missing scheduler secret fails; with the matching secret it syncs only allowlisted users. Automation off performs no listing writes. Automation on still respects approvals, verified snapshots, max action count and production gate. Check concurrent calls and duplicate queue entries.
11. **Metrics:** add product costs to one order's SKUs; verify the estimate and coverage. Unknown-cost and non-USD orders do not silently become zero-cost USD profit.
12. **Deployment:** test the repository subpath, login after refresh, desktop/mobile layout, and light/dark persistence on the actual host. No frontend source or build output may contain privileged keys.

## Recovery

Use the action result's offer/listing ID when a publication needs reconciliation. Do not delete an action to force retry. Check whether eBay already created the listing or shipment. Record the outcome by closing the review, then sync before proposing another action. If a function is interrupted while an action is `running`, the next authorized request or scheduled run marks it for manual review after ten minutes rather than retrying it.
