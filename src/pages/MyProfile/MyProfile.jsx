import React, { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { doc, onSnapshot, setDoc } from "firebase/firestore"
import {
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth"
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage"
import { fireDB, auth, storage } from "../../context/FirebaseConfig"
import { validateImageFile } from "../../utils/uploadValidation"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
  ArrowLeft, Pencil, Camera, Lock, Copy, Check, Eye, EyeOff, X,
  Home as HomeIcon, Search as SearchIcon, ShoppingCart, Heart as HeartIcon, User as UserIcon,
} from "lucide-react"
import useIsMobile from "../../hooks/useIsMobile"

/* ── Palette (matches the rest of the project) ── */
const C = {
  pageBg: "var(--color-background)",
  card: "var(--color-surface)",
  primary: "var(--color-primary)",
  textPri: "var(--color-ink)",
  textSec: "var(--color-muted)",
  border: "color-mix(in srgb, var(--color-border) 30%, transparent)",
  inputBg: "var(--color-surface-muted)",
  green: "var(--color-primary)",
  red: "var(--color-error)",
}

const getInitials = (name) => {
  if (!name) return "U"
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "U"
  return parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}

const formatDate = (val) => {
  if (!val) return ""
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

const MyProfile = () => {
  const navigate = useNavigate()
  const isMobile = useIsMobile(640)

  const containerRef = useRef(null)
  const toastRef = useRef(null)
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState({})
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("personal")
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")
  const [needsReauth, setNeedsReauth] = useState(false)

  const [form, setForm] = useState({
    name: "", phone: "", gender: "", dateOfBirth: "",
    addressStreet: "", addressCity: "", addressState: "", addressPincode: "",
  })

  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" })
  const [pwShow, setPwShow] = useState({ current: false, next: false, confirm: false })
  const [pwErrors, setPwErrors] = useState({})

  const [toast, setToast] = useState({ show: false, message: "" })

  const currentUser = auth.currentUser

  /* ── Live Firestore read (unsubscribe on unmount) ── */
  useEffect(() => {
    const user = auth.currentUser
    if (!user) {
      navigate("/login")
      return
    }
    const unsub = onSnapshot(
      doc(fireDB, "users", user.uid),
      (snap) => {
        setProfile(snap.exists() ? snap.data() : {})
        setLoading(false)
      },
      (err) => {
        console.error("Profile read error:", err)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [navigate])

  /* ── Skeleton shimmer (GSAP opacity pulse, not CSS keyframes) ── */
  useGSAP(() => {
    if (!loading) return
    gsap.to(".profile-skeleton", {
      opacity: 0.4, duration: 0.8, repeat: -1, yoyo: true, ease: "sine.inOut",
    })
  }, { scope: containerRef, dependencies: [loading] })

  /* ── Toast entrance / exit (GSAP fromTo) ── */
  useEffect(() => {
    if (!toast.show || !toastRef.current) return
    gsap.fromTo(
      toastRef.current,
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: "power2.out" }
    )
    const t = setTimeout(() => {
      const el = toastRef.current
      if (el) {
        gsap.to(el, {
          y: 24, opacity: 0, duration: 0.4, ease: "power2.in",
          onComplete: () => setToast({ show: false, message: "" }),
        })
      } else {
        setToast({ show: false, message: "" })
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [toast.show])

  const showToast = (message) => setToast({ show: true, message })

  /* ── Derived display values ── */
  const displayName = profile.name || currentUser?.displayName || "User"
  const initials = getInitials(displayName)
  const photoURL = profile.photoURL || currentUser?.photoURL || ""
  const email = currentUser?.email || profile.email || ""
  const emailVerified = !!currentUser?.emailVerified
  const uid = currentUser?.uid || ""
  const memberSince = formatDate(currentUser?.metadata?.creationTime || profile.createdAt)
  const addressObj =
    profile.address && typeof profile.address === "object"
      ? profile.address
      : typeof profile.address === "string"
        ? { street: profile.address }
        : {}
  const addressDisplay = [addressObj.street, addressObj.city, addressObj.state, addressObj.pincode]
    .filter(Boolean)
    .join(", ")
  const uidShort = uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : "—"

  /* ── Handlers ── */
  const openModal = (tab = "personal") => {
    const a = profile.address && typeof profile.address === "object" ? profile.address : {}
    setForm({
      name: profile.name || currentUser?.displayName || "",
      phone: profile.phone || "",
      gender: profile.gender || "",
      dateOfBirth: profile.dateOfBirth || "",
      addressStreet: a.street || (typeof profile.address === "string" ? profile.address : ""),
      addressCity: a.city || "",
      addressState: a.state || "",
      addressPincode: a.pincode || "",
    })
    setActiveTab(tab)
    setModalError("")
    setNeedsReauth(false)
    setPwErrors({})
    setPwForm({ current: "", next: "", confirm: "" })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
  }

  const handleSavePersonal = async () => {
    const user = auth.currentUser
    if (!user) return
    try {
      setSaving(true)
      setModalError("")
      const updates = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        gender: form.gender,
        dateOfBirth: form.dateOfBirth,
        address: {
          street: form.addressStreet.trim(),
          city: form.addressCity.trim(),
          state: form.addressState.trim(),
          pincode: form.addressPincode.trim(),
        },
      }
      // Update Auth profile + Firestore document simultaneously
      await Promise.all([
        updateProfile(user, { displayName: updates.name }),
        setDoc(doc(fireDB, "users", user.uid), updates, { merge: true }),
      ])
      setModalOpen(false)
      showToast("Profile updated successfully")
    } catch (err) {
      console.error("Save profile error:", err)
      setModalError(err.message || "Failed to update profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    const user = auth.currentUser
    if (!user) return
    const errs = {}
    if (!pwForm.current) errs.current = "Enter your current password"
    if (pwForm.next.length < 8) errs.next = "Minimum 8 characters"
    if (pwForm.next !== pwForm.confirm) errs.confirm = "Passwords do not match"
    setPwErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setSaving(true)
      setModalError("")
      setNeedsReauth(false)
      const cred = EmailAuthProvider.credential(user.email, pwForm.current)
      await reauthenticateWithCredential(user, cred)
      await updatePassword(user, pwForm.next)
      setModalOpen(false)
      setPwForm({ current: "", next: "", confirm: "" })
      showToast("Password updated successfully")
    } catch (err) {
      console.error("Change password error:", err)
      if (err.code === "auth/requires-recent-login") {
        setModalError("Please sign in again before changing your password")
        setNeedsReauth(true)
      } else if (
        err.code === "auth/wrong-password" ||
        err.code === "auth/invalid-credential"
      ) {
        setPwErrors({ current: "Current password is incorrect" })
      } else {
        setModalError(err.message || "Failed to change password. Please try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    const user = auth.currentUser
    if (!file || !user) return
    const _imgCheck = validateImageFile(file, { maxBytes: 2 * 1024 * 1024, allowGif: false })
    if (!_imgCheck.ok) {
      showToast(_imgCheck.error)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    try {
      setUploading(true)
      const sRef = storageRef(storage, `avatars/${user.uid}`)
      await uploadBytes(sRef, file)
      const url = await getDownloadURL(sRef)
      await Promise.all([
        updateProfile(user, { photoURL: url }),
        setDoc(doc(fireDB, "users", user.uid), { photoURL: url }, { merge: true }),
      ])
      showToast("Profile photo updated")
    } catch (err) {
      console.error("Photo upload error:", err)
      showToast("Photo upload failed. Please try again.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const copyUid = async () => {
    if (!uid) return
    try {
      await navigator.clipboard.writeText(uid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error("Copy failed:", e)
    }
  }

  /* ── Small render helpers ── */
  const avatar = (size) => (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ width: size, height: size, borderRadius: "9999px", background: "var(--color-error-subtle)" }}
      >
        {photoURL ? (
          <img src={photoURL} alt={displayName} className="w-full h-full" style={{ objectFit: "cover" }} />
        ) : (
          <span style={{ color: C.primary, fontWeight: 700, fontSize: Math.round(size * 0.33) }}>{initials}</span>
        )}
      </div>
      <button
        onClick={() => fileInputRef.current?.click()}
        aria-label="Change photo"
        disabled={uploading}
        className="absolute flex items-center justify-center"
        style={{ bottom: 0, right: 0, width: "24px", height: "24px", borderRadius: "9999px", background: C.primary, border: "2px solid var(--color-inverse)" }}
      >
        <Camera size={12} color="var(--color-inverse)" />
      </button>
    </div>
  )

  const verifiedPill = (
    <span
      style={{
        display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "9999px",
        fontSize: "11px", fontWeight: 600,
        background: emailVerified ? "var(--color-success-subtle)" : "var(--color-error-subtle)",
        color: emailVerified ? C.green : "var(--color-error)",
      }}
    >
      {emailVerified ? "Verified" : "Unverified"}
    </span>
  )

  const kvLabel = (size) => ({ fontSize: size, fontWeight: 500, color: C.textSec, textTransform: "uppercase", letterSpacing: "0.6px" })

  // Desktop label/value row
  const desktopRow = (label, value) => (
    <div className="flex flex-col" style={{ gap: "4px" }}>
      <span style={kvLabel("12px")}>{label}</span>
      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{value || "—"}</span>
    </div>
  )

  // Mobile field row with divider
  const mobileRow = (label, value, last, extra) => (
    <div
      className="flex items-center justify-between"
      style={{ padding: "10px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, gap: "12px" }}
    >
      <div className="flex flex-col" style={{ gap: "2px", minWidth: 0 }}>
        <span style={kvLabel("11px")}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: C.textPri, wordBreak: "break-word" }}>{value || "—"}</span>
      </div>
      {extra}
    </div>
  )

  const copyBtn = (
    <button onClick={copyUid} aria-label="Copy UID" className="flex items-center justify-center flex-shrink-0" style={{ width: "28px", height: "28px", color: C.textSec }}>
      {copied ? <Check size={15} color={C.green} /> : <Copy size={15} />}
    </button>
  )

  const changePwLink = (
    <button onClick={() => openModal("password")} style={{ fontSize: "12px", fontWeight: 700, color: C.primary }}>
      Change
    </button>
  )

  /* ── Skeleton (GSAP-pulsed) ── */
  const skeletonBlock = (style) => <div aria-hidden="true" className="profile-skeleton" style={{ background: C.inputBg, borderRadius: "8px", ...style }} />

  // A label + value row placeholder (mirrors the real key/value rows).
  const skeletonRow = (key) => (
    <div key={key} className="flex flex-col" style={{ gap: "6px" }}>
      {skeletonBlock({ width: "35%", height: "12px" })}
      {skeletonBlock({ width: "65%", height: "16px" })}
    </div>
  )

  // A card placeholder: heading bar + `rows` key/value rows.
  const skeletonCard = (rows, extra) => (
    <div style={{ background: C.card, borderRadius: "12px", padding: isMobile ? "16px" : "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", ...extra }}>
      {skeletonBlock({ width: "50%", height: "16px", marginBottom: isMobile ? "12px" : "20px" })}
      <div className="flex flex-col" style={{ gap: "16px" }}>
        {[...Array(rows)].map((_, i) => skeletonRow(i))}
      </div>
    </div>
  )

  // Content-aware skeleton — mirrors the real profile layout (avatar header +
  // info cards) at each breakpoint so the swap to real data causes no jump.
  const renderSkeleton = () =>
    isMobile ? (
      <>
        <div className="flex flex-col items-center text-center" style={{ padding: "24px 20px 16px", gap: "8px" }}>
          {skeletonBlock({ width: "80px", height: "80px", borderRadius: "9999px" })}
          {skeletonBlock({ width: "160px", height: "20px", marginTop: "4px" })}
          {skeletonBlock({ width: "200px", height: "13px" })}
          {skeletonBlock({ width: "110px", height: "22px", borderRadius: "9999px" })}
        </div>
        <div className="flex flex-col" style={{ padding: "0 16px", gap: "16px" }}>
          {skeletonCard(4)}
          {skeletonCard(4)}
          {skeletonCard(1)}
        </div>
      </>
    ) : (
      <>
        {/* Header card */}
        <div className="flex items-center" style={{ background: C.card, borderRadius: "16px", padding: "32px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", marginBottom: "24px", gap: "24px" }}>
          {skeletonBlock({ width: "96px", height: "96px", borderRadius: "9999px", flexShrink: 0 })}
          <div className="flex flex-col" style={{ gap: "10px", flex: 1, minWidth: 0 }}>
            {skeletonBlock({ width: "220px", height: "24px" })}
            {skeletonBlock({ width: "260px", height: "14px" })}
            {skeletonBlock({ width: "120px", height: "22px", borderRadius: "9999px" })}
          </div>
          {skeletonBlock({ width: "120px", height: "38px", borderRadius: "9999px", flexShrink: 0 })}
        </div>
        {/* Info cards grid */}
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {skeletonCard(4)}
          {skeletonCard(4)}
          {skeletonCard(2, { gridColumn: "1 / -1" })}
        </div>
      </>
    )

  /* =========================================================
     EDIT MODAL (shared)
  ========================================================= */
  const editModal = modalOpen && (
    <div
      className="fixed inset-0 z-[120] flex"
      style={{
        background: "var(--color-overlay)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
      }}
      onClick={closeModal}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full"
        style={{
          maxWidth: isMobile ? "100%" : "480px",
          borderRadius: isMobile ? "16px 16px 0 0" : "16px",
          padding: "24px",
          paddingBottom: isMobile ? "calc(24px + env(safe-area-inset-bottom, 16px))" : "24px",
          maxHeight: "92vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: C.textPri }}>Edit Profile</h2>
          <button onClick={closeModal} aria-label="Close"><X size={20} color={C.textSec} /></button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ background: C.inputBg, borderRadius: "9999px", padding: "4px", marginBottom: "20px" }}>
          {[
            { key: "personal", label: "Personal Info" },
            { key: "password", label: "Change Password" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setModalError("") }}
              className="flex-1"
              style={{
                padding: "8px 12px", borderRadius: "9999px", fontSize: "13px", fontWeight: 600,
                background: activeTab === t.key ? "var(--color-surface)" : "transparent",
                color: activeTab === t.key ? C.textPri : C.textSec,
                boxShadow: activeTab === t.key ? "0px 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "personal" ? (
          <div className="flex flex-col" style={{ gap: "14px" }}>
            {[
              { key: "name", label: "Full Name", type: "text", placeholder: "Your name" },
              { key: "phone", label: "Phone", type: "tel", placeholder: "Phone number" },
            ].map((f) => (
              <label key={f.key} className="flex flex-col" style={{ gap: "6px" }}>
                <span style={kvLabel("11px")}>{f.label}</span>
                <input
                  className="profile-input"
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </label>
            ))}

            <label className="flex flex-col" style={{ gap: "6px" }}>
              <span style={kvLabel("11px")}>Gender</span>
              <select className="profile-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>

            <label className="flex flex-col" style={{ gap: "6px" }}>
              <span style={kvLabel("11px")}>Date of Birth</span>
              <input className="profile-input" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </label>

            <span style={{ ...kvLabel("11px"), marginTop: "4px" }}>Delivery Address</span>
            <input className="profile-input" type="text" placeholder="Street" value={form.addressStreet} onChange={(e) => setForm({ ...form, addressStreet: e.target.value })} />
            <div className="grid grid-cols-2" style={{ gap: "10px" }}>
              <input className="profile-input" type="text" placeholder="City" value={form.addressCity} onChange={(e) => setForm({ ...form, addressCity: e.target.value })} />
              <input className="profile-input" type="text" placeholder="State" value={form.addressState} onChange={(e) => setForm({ ...form, addressState: e.target.value })} />
            </div>
            <input className="profile-input" type="text" placeholder="Pincode" value={form.addressPincode} onChange={(e) => setForm({ ...form, addressPincode: e.target.value })} />
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: "14px" }}>
            {[
              { key: "current", label: "Current Password" },
              { key: "next", label: "New Password" },
              { key: "confirm", label: "Confirm New Password" },
            ].map((f) => (
              <label key={f.key} className="flex flex-col" style={{ gap: "6px" }}>
                <span style={kvLabel("11px")}>{f.label}</span>
                <div className="relative">
                  <input
                    className="profile-input"
                    style={{ paddingRight: "44px" }}
                    type={pwShow[f.key] ? "text" : "password"}
                    value={pwForm[f.key]}
                    onChange={(e) => { setPwForm({ ...pwForm, [f.key]: e.target.value }); setPwErrors({ ...pwErrors, [f.key]: "" }) }}
                  />
                  <button
                    type="button"
                    onClick={() => setPwShow({ ...pwShow, [f.key]: !pwShow[f.key] })}
                    aria-label="Toggle visibility"
                    className="absolute flex items-center justify-center"
                    style={{ right: "12px", top: "50%", transform: "translateY(-50%)", color: C.textSec }}
                  >
                    {pwShow[f.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {pwErrors[f.key] && <span style={{ fontSize: "12px", fontWeight: 500, color: C.red }}>{pwErrors[f.key]}</span>}
              </label>
            ))}
            {needsReauth && (
              <button
                onClick={handleChangePassword}
                style={{ alignSelf: "flex-start", fontSize: "13px", fontWeight: 700, color: C.primary }}
              >
                Re-authenticate
              </button>
            )}
          </div>
        )}

        {modalError && (
          <p style={{ marginTop: "14px", fontSize: "12px", fontWeight: 500, color: C.red }}>{modalError}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end" style={{ gap: "12px", marginTop: "24px" }}>
          <button
            onClick={closeModal}
            disabled={saving}
            style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 600, color: C.textPri, background: "transparent", opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={activeTab === "personal" ? handleSavePersonal : handleChangePassword}
            disabled={saving}
            className="flex items-center justify-center"
            style={{ background: C.primary, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 700, color: "var(--color-inverse)", boxShadow: "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)", gap: "8px", minWidth: "140px", opacity: saving ? 0.85 : 1 }}
          >
            {saving ? <span className="myprofile-spinner" /> : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  )

  const toastEl = toast.show && (
    <div
      ref={toastRef}
      className="fixed flex items-center justify-center"
      style={{
        left: "50%", transform: "translateX(-50%)",
        bottom: isMobile ? "92px" : "32px", zIndex: 130,
        background: C.textPri, color: "var(--color-inverse)", borderRadius: "12px",
        padding: "12px 20px", fontSize: "14px", fontWeight: 600,
        boxShadow: "0px 10px 30px rgba(0,0,0,0.2)", maxWidth: "90vw",
      }}
    >
      {toast.message}
    </div>
  )

  const styleTag = (
    <style>{`
      .profile-input{width:100%;background:${C.inputBg};border-radius:12px;padding:12px 16px;border:1px solid transparent;font-size:14px;color:${C.textPri};font-family:'Inter',sans-serif;outline:none;transition:border-color .15s,background .15s;}
      .profile-input:focus{border-color:${C.textPri};background:var(--color-surface);}
      .profile-input::placeholder{color:${C.textSec};}
      @keyframes myprofileSpin{to{transform:rotate(360deg);}}
      .myprofile-spinner{width:16px;height:16px;border:2px solid color-mix(in srgb, var(--color-inverse) 40%, transparent);border-top-color:var(--color-inverse);border-radius:9999px;animation:myprofileSpin .7s linear infinite;}
    `}</style>
  )

  /* =========================================================
     MOBILE LAYOUT (≤640px)
  ========================================================= */
  if (isMobile) {
    const sectionHeading = (title, withPencil) => (
      <div className="flex items-center justify-between" style={{ marginBottom: "4px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{title}</h3>
        {withPencil && (
          <button onClick={() => openModal("personal")} aria-label="Edit"><Pencil size={16} color={C.primary} /></button>
        )}
      </div>
    )
    return (
      <div ref={containerRef} className="min-h-screen w-full" style={{ background: C.pageBg, fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        {styleTag}
        <main style={{ paddingTop: "96px", paddingBottom: "80px" }}>
          {loading ? (
            renderSkeleton()
          ) : (
            <>
              {/* Avatar + name */}
              <div className="flex flex-col items-center text-center" style={{ padding: "24px 20px 16px", gap: "8px" }}>
                {avatar(80)}
                <h1 style={{ fontSize: "20px", fontWeight: 700, color: C.textPri, marginTop: "4px" }}>{displayName}</h1>
                <p style={{ fontSize: "13px", fontWeight: 400, color: C.textSec }}>{email}</p>
                {verifiedPill}
              </div>

              <div className="flex flex-col" style={{ padding: "0 16px", gap: "16px" }}>
                {/* Personal Information */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Personal Information", true)}
                  {mobileRow("Full Name", profile.name || currentUser?.displayName)}
                  {mobileRow("Gender", profile.gender)}
                  {mobileRow("Date of Birth", formatDate(profile.dateOfBirth) || profile.dateOfBirth)}
                  {mobileRow("Phone", profile.phone, true)}
                </section>

                {/* Account & Security */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Account & Security", false)}
                  {mobileRow("Email Address", email, false, <Lock size={14} color={C.textSec} className="flex-shrink-0" />)}
                  {mobileRow("Password", "••••••••", false, changePwLink)}
                  {mobileRow("Member Since", memberSince)}
                  {mobileRow("User ID", uidShort, true, copyBtn)}
                </section>

                {/* Delivery Address */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Delivery Address", !!addressDisplay)}
                  {addressDisplay ? (
                    <p style={{ fontSize: "13px", fontWeight: 600, color: C.textPri, paddingTop: "6px", lineHeight: "20px" }}>{addressDisplay}</p>
                  ) : (
                    <button
                      onClick={() => openModal("personal")}
                      className="w-full flex items-center justify-center"
                      style={{ marginTop: "8px", padding: "16px", borderRadius: "12px", border: `1px dashed ${C.border}`, color: C.primary, fontSize: "13px", fontWeight: 600, background: "transparent" }}
                    >
                      + Add Address
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
        </main>

        {/* BOTTOM NAV — superseded by the global MobileNav tab bar; hidden. */}
        <nav
          className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-around"
          style={{ display: "none", height: "64px", background: "color-mix(in srgb, var(--color-background) 80%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderRadius: "12px 12px 0 0", boxShadow: "0px 10px 15px -3px rgba(0,0,0,0.1), 0px 4px 6px -4px rgba(0,0,0,0.1)" }}
        >
          {[
            { icon: HomeIcon, label: "Home", to: "/" },
            { icon: SearchIcon, label: "Search", to: "/products" },
            { icon: ShoppingCart, label: "Cart", to: "/cart" },
            { icon: HeartIcon, label: "Wishlist", to: "/wishlist" },
            { icon: UserIcon, label: "Profile", to: "/myprofile", active: true },
          ].map((n) => {
            const Icon = n.icon
            return (
              <button key={n.label} onClick={() => !n.active && navigate(n.to)} className="flex flex-col items-center justify-center" style={{ gap: "4px", color: n.active ? C.primary : "var(--color-body)" }}>
                <Icon size={20} />
                <span style={{ fontSize: "10px", fontWeight: 500 }}>{n.label}</span>
              </button>
            )
          })}
        </nav>

        {editModal}
        {toastEl}
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
      </div>
    )
  }

  /* =========================================================
     DESKTOP LAYOUT (≥768px) — uses the existing global Navbar
  ========================================================= */
  return (
    <div ref={containerRef} className="min-h-screen w-full" style={{ background: C.pageBg, fontFamily: "Inter, sans-serif" }}>
      {styleTag}
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 24px" }}>
        {loading ? (
          renderSkeleton()
        ) : (
          <>
            {/* HEADER CARD */}
            <div
              className="flex items-center"
              style={{ background: C.card, borderRadius: "16px", padding: "32px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", marginBottom: "24px", gap: "24px" }}
            >
              {avatar(96)}
              <div className="flex flex-col" style={{ gap: "6px", flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: "24px", fontWeight: 700, color: C.textPri }}>{displayName}</h1>
                <p style={{ fontSize: "14px", fontWeight: 400, color: C.textSec }}>{email}</p>
                <div>{verifiedPill}</div>
              </div>
              <button
                onClick={() => openModal("personal")}
                className="flex-shrink-0"
                style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "8px 20px", fontSize: "14px", fontWeight: 600, color: C.textPri, background: "transparent" }}
              >
                Edit Profile
              </button>
            </div>

            {/* INFO CARDS GRID */}
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Card 1 — Personal Information */}
              <div style={{ background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "20px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri }}>Personal Information</h2>
                  <button onClick={() => openModal("personal")} aria-label="Edit personal info"><Pencil size={16} color={C.primary} /></button>
                </div>
                <div className="flex flex-col" style={{ gap: "16px" }}>
                  {desktopRow("Full Name", profile.name || currentUser?.displayName)}
                  {desktopRow("Gender", profile.gender)}
                  {desktopRow("Date of Birth", formatDate(profile.dateOfBirth) || profile.dateOfBirth)}
                  {desktopRow("Phone", profile.phone)}
                </div>
              </div>

              {/* Card 2 — Account & Security */}
              <div style={{ background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri, marginBottom: "20px" }}>Account &amp; Security</h2>
                <div className="flex flex-col" style={{ gap: "16px" }}>
                  <div className="flex flex-col" style={{ gap: "4px" }}>
                    <span style={kvLabel("12px")}>Email Address</span>
                    <span className="flex items-center" style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, gap: "8px" }}>
                      <Lock size={14} color={C.textSec} /> {email || "—"}
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col" style={{ gap: "4px" }}>
                      <span style={kvLabel("12px")}>Password</span>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, letterSpacing: "2px" }}>••••••••</span>
                    </div>
                    {changePwLink}
                  </div>
                  {desktopRow("Member Since", memberSince)}
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col" style={{ gap: "4px", minWidth: 0 }}>
                      <span style={kvLabel("12px")}>User ID</span>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{uidShort}</span>
                    </div>
                    {copyBtn}
                  </div>
                </div>
              </div>

              {/* Card 3 — Delivery Address (full width) */}
              <div style={{ gridColumn: "1 / -1", background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri }}>Delivery Address</h2>
                  {addressDisplay && (
                    <button onClick={() => openModal("personal")} aria-label="Edit address"><Pencil size={16} color={C.primary} /></button>
                  )}
                </div>
                {addressDisplay ? (
                  <p style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, lineHeight: "22px" }}>{addressDisplay}</p>
                ) : (
                  <button
                    onClick={() => openModal("personal")}
                    className="w-full flex items-center justify-center"
                    style={{ padding: "24px", borderRadius: "12px", border: `1px dashed ${C.border}`, color: C.primary, fontSize: "14px", fontWeight: 600, background: "transparent" }}
                  >
                    + Add Address
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {editModal}
      {toastEl}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
    </div>
  )
}

export default MyProfile