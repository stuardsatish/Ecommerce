/**
 * Firebase Cloud Functions entry point.
 *
 * A single HTTPS function `api` wraps an Express app. Payment routes are mounted
 * so they resolve both when the function is hit directly
 * (https://<region>-<project>.cloudfunctions.net/api/payment/...) and when it is
 * reached through the Hosting rewrite (/api/payment/... -> function `api`).
 */
const { onRequest } = require("firebase-functions/v2/https");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Admin SDK has full Firestore access (bypasses security rules), so the server
// is the authority for pricing + order writes. Initialise once.
if (!admin.apps.length) admin.initializeApp();

const paymentRoutes = require("./routes/payment");
const reviewRoutes  = require("./routes/reviews");
const ordersRoutes  = require("./routes/orders");

const app = express();

app.use(cors({ origin: true }));
// Keep the raw body so the Razorpay webhook can verify its HMAC signature.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Direct invocation strips the function name, so the path is `/payment/...`.
// Behind the Hosting rewrite the path arrives as `/api/payment/...`.
app.use(["/payment", "/api/payment"], paymentRoutes);
app.use(["/reviews",  "/api/reviews"],  reviewRoutes);
app.use(["/orders",   "/api/orders"],   ordersRoutes);

app.get(["/health", "/api/health"], (req, res) => res.json({ ok: true }));

exports.api = onRequest({ region: "us-central1" }, app);