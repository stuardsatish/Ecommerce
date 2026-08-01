import React, { useState, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, fireDB } from "../../context/FirebaseConfig";
import { useDispatch, useSelector } from "react-redux";
import { startLoading, stopLoading } from "../../context/LoadingSlice";
import { setUser } from "../../context/UserSlice";
import { doc, getDoc } from "firebase/firestore";
import { queryActiveTabs, broadcastAuth } from "../../utils/sessionUtils";
import { registerNewSession } from "../../utils/sessionManager";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Eye, EyeOff, AlertTriangle, Info } from "lucide-react";

const labelStyle = {
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--color-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
};

const LoginPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const containerRef = useRef(null);
  const loading = useSelector((state) => state.loading.loading);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false); // Why-were-you-logged-out banner (set by sessionManager.forceLogout).

  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const sessionMsg =
    reason === "session_conflict"
      ? {
          show: true,
          type: "warning",
          title: "You were logged out",
          message:
            "Your account was accessed from another device. For your security, this session was ended. Please log in again.",
        }
      : reason === "no_session"
        ? {
            show: true,
            type: "info",
            title: "Session expired",
            message: "Your session has expired. Please log in again.",
          }
        : { show: false };

  useGSAP(
    () => {
      const tl = gsap.timeline({
        defaults: { ease: "power3.out", duration: 0.7 },
      });
      tl.from(".auth-card", { y: 30, opacity: 0 })
        .from(".auth-head > *", { y: 16, opacity: 0, stagger: 0.08 }, "-=0.4")
        .from(".auth-form > *", { y: 14, opacity: 0, stagger: 0.06 }, "-=0.4");
    },
    { scope: containerRef },
  );

  const getFirebaseError = (code) => {
    switch (code) {
      case "auth/user-not-found":
        return "No account found with this email";
      case "auth/wrong-password":
        return "Incorrect password";
      case "auth/invalid-credential":
        return "Incorrect email or password";
      case "auth/invalid-email":
        return "Invalid email format";
      default:
        return "Login failed. Please try again.";
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    } // Block a conflicting second login while another tab is already authenticated.

    const otherTab = await queryActiveTabs();
    if (otherTab?.role) {
      toast.error(
        `You are already logged in as ${otherTab.role} in another tab. Please logout first.`,
      );
      return;
    }

    try {
      dispatch(startLoading());
      const result = await signInWithEmailAndPassword(auth, email, password);
      const docRef = doc(fireDB, "users", result.user.uid);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        toast.error("User profile not found");
        return;
      }

      const userData = docSnap.data();
      dispatch(
        setUser({
          ...userData,
          uid: result.user.uid,
          createdAt: userData.createdAt?.toDate
            ? userData.createdAt.toDate().toISOString()
            : userData.createdAt,
          lastOrderDate: userData.lastOrderDate?.toDate
            ? userData.lastOrderDate.toDate().toISOString()
            : userData.lastOrderDate,
          lastLoginAt: userData.lastLoginAt?.toDate
            ? userData.lastLoginAt.toDate().toISOString()
            : userData.lastLoginAt || null,
        }),
      ); // Single-session: overwrite any active session on other devices.

      await registerNewSession(result.user.uid);

      broadcastAuth("login", { role: userData.role, userId: result.user.uid });
      toast.success("Welcome back ");
      if (userData.role === "admin") navigate("/admin/myorders");
      else navigate("/");
    } catch (error) {
      toast.error(getFirebaseError(error.code));
    } finally {
      dispatch(stopLoading());
    }
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "var(--color-background)",
        fontFamily: "Inter, sans-serif",
        padding: "24px",
      }}
    >
           {" "}
      <style>{`
        .auth-input{width:100%;background:var(--color-surface-muted);border:1px solid transparent;border-radius:12px;padding:12px 14px;font-size:14px;color:var(--color-ink);font-family:'Inter',sans-serif;outline:none;transition:border-color .15s,background .15s;}
        .auth-input:focus{border-color:var(--color-ink);background:var(--color-surface);}
        .auth-input::placeholder{color:var(--color-muted);}
        @keyframes authSpin{to{transform:rotate(360deg);}}
        .auth-spinner{width:16px;height:16px;border:2px solid color-mix(in srgb, var(--color-inverse) 40%, transparent);border-top-color:var(--color-inverse);border-radius:9999px;animation:authSpin .7s linear infinite;}
      `}</style>
           {" "}
      <div
        className="auth-card w-full"
        style={{
          maxWidth: "440px",
          background: "var(--color-surface)",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
        }}
      >
               {" "}
        {sessionMsg.show && (
          <div
            className="flex items-start gap-3"
            style={{
              padding: "16px",
              borderRadius: "12px",
              marginBottom: "24px",
              border: `1px solid ${sessionMsg.type === "warning" ? "var(--color-accent-subtle)" : "var(--color-info-border)"}`,
              background:
                sessionMsg.type === "warning"
                  ? "var(--color-accent-subtle)"
                  : "var(--color-info-subtle)",
              color:
                sessionMsg.type === "warning"
                  ? "var(--color-accent-strong)"
                  : "var(--color-info)",
            }}
          >
                       {" "}
            <span style={{ marginTop: "2px", flexShrink: 0 }}>
                           {" "}
              {sessionMsg.type === "warning" ? (
                <AlertTriangle
                  size={18}
                  style={{ color: "var(--color-accent)" }}
                />
              ) : (
                <Info size={18} style={{ color: "var(--color-info)" }} />
              )}
                         {" "}
            </span>
                       {" "}
            <span>
                           {" "}
              <p style={{ fontWeight: 600, fontSize: "14px" }}>
                {sessionMsg.title}
              </p>
                           {" "}
              <p style={{ fontSize: "14px", marginTop: "2px", opacity: 0.85 }}>
                {sessionMsg.message}
              </p>
                         {" "}
            </span>
                     {" "}
          </div>
        )}
               {" "}
        <div className="auth-head" style={{ marginBottom: "24px" }}>
                   {" "}
          <h1
            style={{
              fontSize: "26px",
              fontWeight: 700,
              color: "var(--color-ink)",
              letterSpacing: "-0.4px",
            }}
          >
            Welcome back
          </h1>
                   {" "}
          <p
            style={{
              fontSize: "14px",
              color: "var(--color-muted)",
              marginTop: "6px",
            }}
          >
            Sign in to continue to your account
          </p>
                 {" "}
        </div>
               {" "}
        <form
          onSubmit={handleLogin}
          className="auth-form flex flex-col"
          style={{ gap: "16px" }}
        >
                   {" "}
          <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Email</span>
                       {" "}
            <input
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
                     {" "}
          </label>
                   {" "}
          <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Password</span>           {" "}
            <div className="relative">
                           {" "}
              <input
                className="auth-input"
                style={{ paddingRight: "44px" }}
                type={showPw ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
                           {" "}
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label="Toggle password visibility"
                className="absolute flex items-center justify-center"
                style={{
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--color-muted)",
                }}
              >
                               {" "}
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}           
                 {" "}
              </button>
                         {" "}
            </div>
                     {" "}
          </label>
                   {" "}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center"
            style={{
              width: "100%",
              background: "var(--color-primary)",
              color: "var(--color-inverse)",
              fontWeight: 700,
              fontSize: "15px",
              padding: "13px",
              borderRadius: "9999px",
              boxShadow:
                "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)",
              marginTop: "4px",
              gap: "8px",
              opacity: loading ? 0.85 : 1,
            }}
          >
                       {" "}
            {loading ? <span className="auth-spinner" /> : "Sign In"}       
             {" "}
          </button>
                 {" "}
        </form>
               {" "}
        <p
          style={{
            fontSize: "14px",
            color: "var(--color-muted)",
            textAlign: "center",
            marginTop: "24px",
          }}
        >
                    New here?          {" "}
          <Link
            to="/signup"
            style={{ color: "var(--color-primary)", fontWeight: 700 }}
          >
            Create an account
          </Link>
                 {" "}
        </p>
             {" "}
      </div>
         {" "}
    </div>
  );
};

export default LoginPage;
