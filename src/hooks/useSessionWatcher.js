import { useEffect, useRef } from "react"
import { doc, onSnapshot } from "firebase/firestore"
import { fireDB } from "../context/FirebaseConfig"
import { getLocalSessionId, forceLogout, inSessionGrace } from "../utils/sessionManager"

/**
 * Watches /users/{uid}.activeSessionId in realtime. When another device logs in
 * it overwrites that id; this device then sees its stored id no longer match and
 * logs itself out. Mount once near the app root with the current user's uid.
 *
 * Important safety properties (so a normal login never logs itself out):
 *  - the local id is read fresh on every snapshot (not captured once),
 *  - a logout only fires when BOTH ids exist and differ,
 *  - mismatches during the post-login grace window are ignored.
 *
 * @param {string|null|undefined} uid
 */
const useSessionWatcher = (uid) => {
  const unsubscribeRef = useRef(null)

  useEffect(() => {
    if (!uid) return

    const userRef = doc(fireDB, "users", uid)
    unsubscribeRef.current = onSnapshot(
      userRef,
      (snapshot) => {
        if (!snapshot.exists()) return
        const firestoreSessionId = snapshot.data()?.activeSessionId
        const localSessionId = getLocalSessionId()

        // Genuine cross-device takeover only: both ids present, they differ, and
        // we're not mid-login. A missing local id (pre-feature / just cleared) is
        // NOT treated as a conflict, so it can never bounce a fresh login.
        if (
          firestoreSessionId &&
          localSessionId &&
          firestoreSessionId !== localSessionId &&
          !inSessionGrace()
        ) {
          console.warn("Session conflict detected. Logging out this device.")
          if (unsubscribeRef.current) unsubscribeRef.current()
          forceLogout("session_conflict")
        }
      },
      (error) => console.log("Session watcher error:", error)
    )

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current()
    }
  }, [uid])
}

export default useSessionWatcher