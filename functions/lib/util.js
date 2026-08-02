const admin = require("firebase-admin");

/**
 * Verify the caller's Firebase ID token (sent as `Authorization: Bearer <token>`).
 * Returns the decoded token, or sends a 401 and returns null.
 */
async function requireAuth(req, res) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    res.status(401).json({ success: false, error: "Invalid or expired session. Please log in again." });
    return null;
  }
}

/**
 * Fixed-window rate limiter backed by Firestore (durable across function
 * instances). Returns true if the call is allowed, false if the limit is hit.
 *
 * @param {string}  key         Unique bucket, e.g. `create-order:<uid>`
 * @param {number}  max         Max calls allowed per window
 * @param {number}  windowMs    Window length in ms
 * @param {object}  [opts]
 * @param {boolean} [opts.failOpen=false]  If true, allow the call when the
 *        limiter itself errors. Defaults to FAIL-CLOSED (deny) so a limiter
 *        outage can't be used to bypass abuse protection on cost-bearing routes.
 */
async function rateLimit(key, max, windowMs, opts = {}) {
  const { failOpen = false } = opts;
  const ref = admin.firestore().collection("rateLimits").doc(key);
  const now = Date.now();
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (!data || now - (data.windowStart || 0) > windowMs) {
        tx.set(ref, { windowStart: now, count: 1 });
        return true;
      }
      if ((data.count || 0) >= max) return false;
      tx.update(ref, { count: (data.count || 0) + 1 });
      return true;
    });
  } catch (e) {
    console.error("[rateLimit] error:", e);
    // Cost-bearing routes pass failOpen:false → deny on limiter failure.
    return failOpen;
  }
}

/**
 * Global per-day counter (e.g. a hard ceiling on paid-API/order creation so a
 * worst-case abuse scenario is bounded regardless of how many accounts an
 * attacker rotates through). Returns true if still under the cap.
 *
 * FAIL-CLOSED on error.
 *
 * @param {string} name   Counter name, e.g. "orders"
 * @param {number} max    Max allowed per UTC day
 * @param {string} day    UTC day string YYYY-MM-DD (caller supplies; Date.now
 *                         is fine in a live function but passed in for testability)
 */
async function globalDailyLimit(name, max, day) {
  const ref = admin.firestore().collection("rateLimits").doc(`global-${name}-${day}`);
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= max) return false;
      tx.set(ref, { count: count + 1, day, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
  } catch (e) {
    console.error("[globalDailyLimit] error:", e);
    return false; // fail-closed
  }
}

/**
 * Admin-controlled kill switch. Reads settings/security. A feature is DISABLED
 * when the corresponding flag is explicitly false, OR when `allDisabled` is true.
 * Missing doc / missing flag → enabled (default-on), so a first deploy works.
 *
 * @param {string} feature  e.g. "orders", "reviews"
 * @returns {Promise<boolean>} true if the feature is killed (should be blocked)
 */
async function isFeatureKilled(feature) {
  try {
    const snap = await admin.firestore().collection("settings").doc("security").get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    if (d.allDisabled === true) return true;
    return d[`${feature}Enabled`] === false;
  } catch (e) {
    console.error("[isFeatureKilled] error:", e);
    return false; // don't take the whole site down if this read fails
  }
}

/**
 * Per-user block check. A user with status === "blocked" (or blocked === true)
 * in their /users doc is refused on sensitive routes without a redeploy.
 * @param {string} uid
 * @returns {Promise<boolean>} true if the user is blocked
 */
async function isUserBlocked(uid) {
  try {
    const snap = await admin.firestore().collection("users").doc(uid).get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    return d.status === "blocked" || d.blocked === true;
  } catch (e) {
    console.error("[isUserBlocked] error:", e);
    return false;
  }
}

module.exports = { requireAuth, rateLimit, globalDailyLimit, isFeatureKilled, isUserBlocked };