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
 * @param {string} key       Unique bucket, e.g. `create-order:<uid>`
 * @param {number} max       Max calls allowed per window
 * @param {number} windowMs  Window length in ms
 */
async function rateLimit(key, max, windowMs) {
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
    // Fail open: a limiter error must never block legitimate traffic.
    console.error("[rateLimit] error:", e);
    return true;
  }
}

module.exports = { requireAuth, rateLimit };