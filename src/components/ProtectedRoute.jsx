import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import Loader from "./Common/Loader";
import { getSession } from "../utils/sessionUtils";

/**
 * Role-aware route guard. Checks BOTH the Redux user (Firebase-backed source
 * of truth) and the per-tab sessionStorage snapshot.
 *
 * @param {Object}   props
 * @param {string[]} props.allowedRoles  Roles permitted (e.g. ['admin'] or ['user']).
 * @param {React.ReactNode} props.children
 */
export default function ProtectedRoute({ allowedRoles = [], children }) {
  const user = useSelector((s) => s.user.user);
  const loading = useSelector((s) => s.loading.loading);

  if (loading) return <Loader />;

  // Not authenticated → login.
  if (!user) return <Navigate to="/login" replace />;

  // Tamper check: if sessionStorage role was hand-edited to differ from the
  // Redux/Firebase role, trust the Firebase-backed role (Redux) for guarding.
  const session = getSession();
  const effectiveRole = user.role || session?.role || null;

  if (allowedRoles.length && !allowedRoles.includes(effectiveRole)) {
    // Logged in but wrong role → send to that role's home.
    return (
      <Navigate
        to={effectiveRole === "admin" ? "/admin/add-product" : "/"}
        replace
      />
    );
  }

  return children;
}
