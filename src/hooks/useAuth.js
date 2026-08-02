import { useSelector, useDispatch } from "react-redux"
import { signOut } from "firebase/auth"
import { auth } from "../context/FirebaseConfig"
import { setUser, clearUser } from "../context/UserSlice"
import { setSession, clearSession, broadcastAuth, getSession } from "../utils/sessionUtils"

/**
 * Auth facade over Firebase + Redux with cross-tab session sync.
 *
 * @returns {{
 *   user: object|null,
 *   role: string|null,
 *   token: string|null,
 *   isAuthenticated: boolean,
 *   isLoading: boolean,
 *   login: (userData: object) => void,
 *   logout: () => Promise<void>,
 *   checkSession: () => object|null
 * }}
 */
export default function useAuth() {
  const dispatch = useDispatch()
  const user = useSelector((s) => s.user.user)
  const isLoading = useSelector((s) => s.loading.loading)

  /** Record an authenticated user in Redux + sessionStorage and notify other tabs. */
  const login = (userData) => {
    if (!userData) return
    dispatch(setUser(userData))
    setSession({
      token: userData.uid,
      role: userData.role,
      userId: userData.uid,
      userName: userData.name,
      email: userData.email,
    })
    broadcastAuth("login", { role: userData.role, userId: userData.uid })
  }

  /** Sign out everywhere (Firebase + Redux + session) and notify all tabs. */
  const logout = async () => {
    try { await signOut(auth) } catch { /* already signed out */ }
    dispatch(clearUser())
    clearSession()
    broadcastAuth("logout")
  }

  /** Read this tab's persisted session. */
  const checkSession = () => getSession()

  return {
    user: user || null,
    role: user?.role || null,
    token: user?.uid || null,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    checkSession,
  }
}