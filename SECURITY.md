# Security Notes & Operational Runbook

This document records the security controls added in the hardening pass and the
operational levers available to admins.

## Server-side enforcement (Cloud Functions)

All money/data mutations are server-authoritative via the Admin SDK:

- **Auth:** every sensitive route verifies a Firebase ID token (`lib/util.js:requireAuth`); `userId` is taken from the token, never the body.
- **Pricing:** Razorpay orders are priced from the catalog server-side. The WhatsApp manual-order route (`routes/orders.js`) now also recomputes item prices from the catalog and refuses a total that disagrees with the pasted message unless the admin explicitly confirms (`allowPriceOverride`).
- **Rate limiting:** per-user limits on `create-order`, `verify`, `reviews/create`, `promo/validate`. The limiter now **fails closed** (denies) on error for cost-bearing routes.
- **Global cap:** hard ceiling on Razorpay order creations per UTC day (`ORDERS_DAILY_CAP`, default 2000).
- **CORS:** restricted to known origins (see `ALLOWED_ORIGINS`), not reflect-any.
- **Headers:** `helmet` adds CSP/HSTS/nosniff/frame-deny.
- **Cleanup:** scheduled `cleanupPendingOrders` purges abandoned pending orders every 6h.

## Kill switch (no redeploy needed)

Create/edit the Firestore document **`settings/security`**:

| Field | Effect |
|---|---|
| `allDisabled: true` | Blocks checkout, manual orders, and reviews immediately. |
| `ordersEnabled: false` | Blocks Razorpay checkout + manual order creation. |
| `reviewsEnabled: false` | Blocks review submission. |

Missing doc / missing field = feature enabled (default-on). Only admins can write
`settings` (Firestore rules).

## Blocking an abusive user (no redeploy needed)

Set on the user's `users/{uid}` document either:
- `status: "blocked"`, or
- `blocked: true`

Blocked users are refused on `create-order` and `reviews/create`.

## Deploy checklist

```bash
# 1. Set secrets (do NOT commit real values)
firebase functions:secrets:set RAZORPAY_KEY_SECRET
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET

# 2. Deploy Firestore + Storage rules (Storage rules are NEW — required)
firebase deploy --only firestore:rules,storage

# 3. Deploy functions (installs helmet, adds the scheduled cleanup)
firebase deploy --only functions

# 4. Deploy hosting
npm run build && firebase deploy --only hosting
```

## Still requires manual/console action

- **Enable Firebase App Check** (reCAPTCHA Enterprise for web; Play Integrity for Android) and enforce it on Functions + Firestore + Storage.
- **Add reCAPTCHA to signup** to stop automated account creation.
- **Wire error monitoring** (Sentry / Google Cloud Error Reporting) into the app and functions.
- **Set budget alerts** on Firebase + Razorpay.
- **`xlsx`**: only used for client-side spreadsheet *export* (never parsing untrusted files), so the known CVEs are not reachable. To clear `npm audit` entirely, replace the npm package with the vendor build from https://cdn.sheetjs.com.