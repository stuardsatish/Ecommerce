import { doc, setDoc, serverTimestamp } from "firebase/firestore"
import { signOut } from "firebase/auth"
import { fireDB, auth } from "../context/FirebaseConfig"

/**
 * Single-session enforcement helpers.
 *
 * Source of truth is /users/{uid}.activeSessionId. Each device stores its own
 * copy in localStorage (SESSION_KEY). A logging-in device overwrites the
 * Firestore id; every other device's watcher (useSessionWatcher) sees the
 * mismatch and logs itself out.
 *
 * NOTE: this is separate from the cross-tab layer in sessionUtils.js
 * (key "auth_session"); this one uses key "app_session_id" and works across
 * devices/browsers, not just tabs.
 */

export const SESSION_KEY = "app_session_id"

/** Random unique session id (crypto when available, fallback otherwise). */
export const generateSessionId = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

/**
 * Register a new session for this device on login. Overwrites any session held
 * by other devices for the same account, then mirrors the id into localStorage.
 * @param {string} uid
 * @returns {Promise<string>} the new session id
 */
// Brief window after a login during which the session watcher ignores
// local/Firestore id mismatches — they're expected while the new id propagates,
// and acting on them would log the user out of the very session they just opened.
let _graceUntil = 0
export const beginSessionGrace = (ms = 10000) => { _graceUntil = Date.now() + ms }
export const inSessionGrace = () => Date.now() < _graceUntil

export const registerNewSession = async (uid) => {
  const sessionId = generateSessionId()

  // Suppress the watcher while local + Firestore settle to the new id.
  beginSessionGrace()

  // Mirror locally, then write the id to Firestore IMMEDIATELY (no slow calls in
  // between) so the two stay in sync within the grace window.
  localStorage.setItem(SESSION_KEY, sessionId)
  const deviceInfo = (navigator.userAgent || "").substring(0, 150)

  // setDoc(merge) rather than updateDoc so a missing user doc never throws.
  try {
    await setDoc(
      doc(fireDB, "users", uid),
      { activeSessionId: sessionId, lastLoginAt: serverTimestamp(), lastLoginDevice: deviceInfo },
      { merge: true }
    )
  } catch (e) {
    console.log("registerNewSession: failed to write session:", e)
  }

  // IP is optional — fetch + store in the background; never block or fail login.
  fetch("https://api.ipify.org?format=json")
    .then((r) => r.json())
    .then((d) => d?.ip && setDoc(doc(fireDB, "users", uid), { lastLoginIP: d.ip }, { merge: true }))
    .catch(() => {})

  return sessionId
}

/** Remove this device's stored session id. */
export const clearLocalSession = () => {
  localStorage.removeItem(SESSION_KEY)
}

/** This device's stored session id (or null). */
export const getLocalSessionId = () => localStorage.getItem(SESSION_KEY)

/**
 * Force this device to log out and bounce to /login with a reason.
 * @param {"session_conflict"|"no_session"|string} reason
 */
export const forceLogout = async (reason = "session_conflict") => {
  clearLocalSession()
  try {
    await signOut(auth)
  } catch (e) {
    console.log("Sign out error:", e)
  }
  window.location.href = `/login?reason=${reason}`
}