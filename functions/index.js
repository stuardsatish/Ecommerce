/**
 * Firebase Cloud Functions entry point.
 *
 * A single HTTPS function `api` wraps an Express app. Payment routes are mounted
 * so they resolve both when the function is hit directly
 * (https://<region>-<project>.cloudfunctions.net/api/payment/...) and when it is
 * reached through the Hosting rewrite (/api/payment/... -> function `api`).
 */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const admin = require("firebase-admin");

// Admin SDK has full Firestore access (bypasses security rules), so the server
// is the authority for pricing + order writes. Initialise once.
if (!admin.apps.length) admin.initializeApp();

const paymentRoutes = require("./routes/payment");
const reviewRoutes = require("./routes/reviews");
const ordersRoutes = require("./routes/orders");
const promoRoutes = require("./routes/promo");

const app = express();

app.disable("x-powered-by");

// Security headers. This is a JSON API (no HTML), so a strict CSP is safe and
// cheap; HSTS + nosniff + frame denial harden the responses regardless.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

// CORS: allow only our known web origins (NOT reflect-any). Capacitor/native
// apps send requests without an Origin header, which `cors` allows by default.
// Override/extend via the ALLOWED_ORIGINS env var (comma-separated).
const DEFAULT_ORIGINS = [
  "https://e-commerce-demo-website1.web.app",
  "https://e-commerce-demo-website1.firebaseapp.com",
  "https://my-sweet-bec4a.web.app",
  "https://my-sweet-bec4a.firebaseapp.com",
  "http://localhost:5173",
];
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_ORIGINS;

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header → non-browser client (native app, curl, server): allow.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST"],
  }),
);

// Cap request bodies (mild DoS / cost guard). Keep the raw body so the Razorpay
// webhook can verify its HMAC signature.
app.use(
  express.json({
    limit: "64kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Direct invocation strips the function name, so the path is `/payment/...`.
// Behind the Hosting rewrite the path arrives as `/api/payment/...`.
app.use(["/payment", "/api/payment"], paymentRoutes);
app.use(["/reviews", "/api/reviews"], reviewRoutes);
app.use(["/orders", "/api/orders"], ordersRoutes);
app.use(["/promo", "/api/promo"], promoRoutes);

app.get(["/health", "/api/health"], (req, res) => res.json({ ok: true }));

// Fallback error handler — never leak stack traces / internals to the client.
app.use((err, req, res, _next) => {
  if (err && /CORS/.test(err.message || "")) {
    return res
      .status(403)
      .json({ success: false, error: "Origin not allowed" });
  }
  console.error("[api] unhandled error:", err);
  return res.status(500).json({ success: false, error: "Internal error" });
});

exports.api = onRequest({ region: "us-central1" }, app);

/**
 * Scheduled cleanup: purge stale /pendingOrders left by abandoned checkouts
 * (status "created" older than 2h). Bounds unbounded growth from repeated
 * create-order calls that never reach /verify.
 */
exports.cleanupPendingOrders = onSchedule(
  { schedule: "every 6 hours", region: "us-central1" },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 60 * 1000,
    );
    const snap = await db
      .collection("pendingOrders")
      .where("status", "==", "created")
      .where("createdAt", "<", cutoff)
      .limit(400)
      .get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(
      `[cleanupPendingOrders] deleted ${snap.size} stale pending orders`,
    );
  },
);
