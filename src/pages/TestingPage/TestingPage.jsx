import React, { useState } from "react";
import {
  collection,
  getDocs,
  doc,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
  query,
  where,
} from "firebase/firestore";
import { fireDB } from "../../context/FirebaseConfig";

/* ============================================================
   CONFIG
============================================================ */
const ORDER_COUNT = 500;
const DAYS_BACK = 548; // ~1.5 years
const BATCH_CHUNK = 400; // ops per batch (Firestore hard limit is 500)
const MAX_DATE_WEIGHT = 1.3 * 1.5 * 1.6; // weekend * december * max recency

/* ============================================================
   SMALL HELPERS (no external libs)
============================================================ */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
};

// Random Timestamp across the past DAYS_BACK with weighting:
// weekends 1.3x, December 1.5x, recent months trend up to 1.6x. Rejection sampling.
const randomWeightedDate = () => {
  // safety cap on iterations
  for (let i = 0; i < 50; i++) {
    const offset = Math.floor(Math.random() * DAYS_BACK);
    const d = new Date();
    d.setDate(d.getDate() - offset);
    d.setHours(randInt(8, 22), randInt(0, 59), randInt(0, 59), 0);
    const dow = d.getDay();
    let w = 1;
    if (dow === 0 || dow === 6) w *= 1.3;
    if (d.getMonth() === 11) w *= 1.5;
    w *= 1 + (1 - offset / DAYS_BACK) * 0.6; // recency / growth trend
    if (Math.random() < w / MAX_DATE_WEIGHT) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * DAYS_BACK));
  return d;
};

const ymd = (d) => d.toISOString().slice(0, 10);

const DAY_MS = 86400000;
// Drive each seeded order through the full lifecycle based on how long ago it
// was placed, so orders complete the flow instead of piling up as "placed".
//   < 1.5 days old → placed (just came in)
//   1.5–4 days      → confirmed
//   4–6 days        → shipped
//   ≥ 6 days        → delivered (delivered 4–5 days after it was placed)
const lifecycleStatus = (placedDate, now) => {
  const ageDays = (now - placedDate) / DAY_MS;
  if (ageDays >= 6) return "delivered";
  if (ageDays >= 4) return "shipped";
  if (ageDays >= 1.5) return "confirmed";
  return "placed";
};

/* Sample data for the Bulk Order Import dashboard (/admin/adminUploadOrders).
   All docs are tagged _seeded:true so "Remove" can delete exactly these. */
const SAMPLE_SESSIONS = [
  {
    fileName: "Q3_Final_Orders.csv",
    status: "success",
    recordCount: 1245,
    successCount: 1241,
    failCount: 4,
  },
  {
    fileName: "wholesale_batch_A.csv",
    status: "active",
    recordCount: 320,
    successCount: 0,
    failCount: 0,
  },
  {
    fileName: "inventory_sync_fail.csv",
    status: "failed",
    recordCount: 88,
    successCount: 0,
    failCount: 88,
  },
  {
    fileName: "retail_partners.csv",
    status: "success",
    recordCount: 540,
    successCount: 538,
    failCount: 2,
  },
  {
    fileName: "promo_signups.csv",
    status: "pending",
    recordCount: 150,
    successCount: 0,
    failCount: 0,
  },
];
const SAMPLE_ACTIVITY = [
  { event: "Validation Completed", actor: "System", type: "success" },
  { event: "New CSV Uploaded", actor: "Alex Rivera", type: "upload" },
  { event: "Template Updated", actor: "System", type: "success" },
  { event: "API Connection Timeout", actor: "System", type: "error" },
  { event: "Duplicate IDs flagged", actor: "System", type: "warning" },
];

const TestingPage = () => {
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [loadingData, setLoadingData] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [seedingUploads, setSeedingUploads] = useState(false);
  const [removingUploads, setRemovingUploads] = useState(false);

  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);

  const busy =
    loadingData ||
    seeding ||
    deleting ||
    backfilling ||
    seedingUploads ||
    removingUploads;

  const log = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 20));
  }; /* ============================================================
     STEP 3 — LOAD REAL DATA
  ============================================================ */

  const loadData = async () => {
    setError("");
    setLoadingData(true);
    try {
      log("Fetching users…");
      const usersSnap = await getDocs(collection(fireDB, "users"));
      const userList = usersSnap.docs.map((d) => {
        const u = d.data();
        return {
          uid: d.id,
          name: u.name || "User",
          email: u.email || `${d.id}@test.com`,
        };
      });

      log("Fetching products…");
      const productsSnap = await getDocs(collection(fireDB, "products"));
      const productList = productsSnap.docs.map((d) => {
        const p = d.data();
        return {
          id: d.id,
          title: p.title || p.name || "Product",
          price: Number(p.price) || 0,
          category: p.category || "general",
          stock: Number(p.stock) || 0,
        };
      });

      setUsers(userList);
      setProducts(productList);

      if (userList.length < 2 || productList.length < 2) {
        setDataLoaded(false);
        setError(
          `Not enough data to seed. Need ≥2 users and ≥2 products. Found ${userList.length} users, ${productList.length} products.`,
        );
        log(
          `ERROR: insufficient data (${userList.length} users, ${productList.length} products)`,
        );
        return;
      }

      setDataLoaded(true);
      log(
        `Loaded ${userList.length} users and ${productList.length} products ✓`,
      );
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR loading data: ${err.message}`);
    } finally {
      setLoadingData(false);
    }
  }; /* ============================================================
     Commit an array of ops (each fn(batch)) in chunks of 400.
  ============================================================ */

  const commitOps = async (ops, onProgress) => {
    for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
      const batch = writeBatch(fireDB);
      ops.slice(i, i + BATCH_CHUNK).forEach((fn) => fn(batch));
      await batch.commit();
      if (onProgress)
        onProgress(
          Math.min(100, Math.round(((i + BATCH_CHUNK) / ops.length) * 100)),
        );
    }
  }; /* ============================================================
     STEP 4 + 5 — GENERATE + SEED
  ============================================================ */

  const generateOrders = async () => {
    if (!dataLoaded) return;
    setError("");
    setSeeding(true);
    setProgress(0);
    try {
      log(`Building ${ORDER_COUNT} orders in memory…`); // 1. Build all orders in memory

      const now = new Date();
      const orders = [];
      for (let i = 0; i < ORDER_COUNT; i++) {
        const date = randomWeightedDate();
        const picks = pickN(products, randInt(1, 4));
        const items = picks.map((p) => ({
          productId: p.id,
          title: p.title,
          price: p.price,
          quantity: randInt(1, 3),
          category: p.category,
        }));
        const total = Math.round(
          items.reduce((s, it) => s + it.price * it.quantity, 0),
        );
        const totalItems = items.reduce((s, it) => s + it.quantity, 0);
        const u = pickOne(users);
        const status = lifecycleStatus(date, now); // Delivered orders get a delivery date 4–5 days after they were placed.
        const deliveredAt =
          status === "delivered"
            ? new Date(date.getTime() + randInt(4, 5) * DAY_MS)
            : null;
        orders.push({
          user: u,
          items,
          total,
          totalItems,
          date,
          status,
          deliveredAt,
        });
      } // 2. Aggregate analytics in memory

      const daily = {},
        monthly = {},
        yearly = {};
      const prodStats = {},
        stockDec = {},
        custStats = {};
      const cartUsers = new Set();

      orders.forEach((o) => {
        const day = ymd(o.date);
        const month = day.slice(0, 7);
        const year = day.slice(0, 4);

        if (!daily[day]) daily[day] = { revenue: 0, orders: 0, customers: 0 };
        daily[day].revenue += o.total;
        daily[day].orders += 1;
        daily[day].customers += 1;

        if (!monthly[month]) monthly[month] = { revenue: 0, orders: 0 };
        monthly[month].revenue += o.total;
        monthly[month].orders += 1;

        if (!yearly[year]) yearly[year] = { revenue: 0, orders: 0 };
        yearly[year].revenue += o.total;
        yearly[year].orders += 1;

        const cu = o.user;
        if (!custStats[cu.uid])
          custStats[cu.uid] = {
            name: cu.name,
            email: cu.email,
            totalOrders: 0,
            totalSpent: 0,
            lastOrderDate: o.date,
          };
        custStats[cu.uid].totalOrders += 1;
        custStats[cu.uid].totalSpent += o.total;
        if (o.date > custStats[cu.uid].lastOrderDate)
          custStats[cu.uid].lastOrderDate = o.date;
        cartUsers.add(cu.uid);

        o.items.forEach((it) => {
          if (!prodStats[it.productId])
            prodStats[it.productId] = {
              title: it.title,
              category: it.category || "general",
              totalOrders: 0,
              totalRevenue: 0,
              totalQuantity: 0,
              lastSoldAt: o.date,
            };
          prodStats[it.productId].totalOrders += 1;
          prodStats[it.productId].totalRevenue += it.price * it.quantity;
          prodStats[it.productId].totalQuantity += it.quantity;
          if (o.date > prodStats[it.productId].lastSoldAt)
            prodStats[it.productId].lastSoldAt = o.date;
          stockDec[it.productId] = (stockDec[it.productId] || 0) + it.quantity;
        });
      });

      log("Assembling write operations…");
      const ops = []; // A. orders (top-level, like CartPage) + per-user subcollection (where the
      //    analytics dashboards read) + H. inventoryLogs

      orders.forEach((o) => {
        const orderRef = doc(collection(fireDB, "orders"));
        const orderData = {
          orderId: orderRef.id,
          userId: o.user.uid,
          userName: o.user.name,
          userEmail: o.user.email,
          total: o.total,
          totalItems: o.totalItems,
          paymentMethod: "COD",
          paymentStatus: "paid",
          orderStatus: o.status,
          createdAt: Timestamp.fromDate(o.date),
          ...(o.deliveredAt
            ? { deliveredAt: Timestamp.fromDate(o.deliveredAt) }
            : {}),
          products: o.items,
          _seeded: true,
        };
        ops.push((b) => b.set(orderRef, orderData)); // Mirror into /users/{uid}/orders/{orderId} — this is what the
        // All Users / All Products analytics dashboards actually read.
        const subRef = doc(fireDB, "users", o.user.uid, "orders", orderRef.id);
        ops.push((b) => b.set(subRef, orderData));
        o.items.forEach((it) => {
          const logRef = doc(collection(fireDB, "inventoryLogs"));
          ops.push((b) =>
            b.set(logRef, {
              productId: it.productId,
              change: -it.quantity,
              reason: "order",
              createdAt: Timestamp.fromDate(o.date),
              _seeded: true,
            }),
          );
        });
      }); // D. daily analytics

      Object.entries(daily).forEach(([day, v]) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "analytics", "daily", "stats", day),
            {
              date: day,
              revenue: increment(v.revenue),
              orders: increment(v.orders),
              customers: increment(v.customers),
            },
            { merge: true },
          ),
        );
      }); // E. monthly
      Object.entries(monthly).forEach(([month, v]) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "analytics", "monthly", "stats", month),
            {
              month,
              revenue: increment(v.revenue),
              orders: increment(v.orders),
            },
            { merge: true },
          ),
        );
      }); // F. yearly
      Object.entries(yearly).forEach(([year, v]) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "analytics", "yearly", "stats", year),
            {
              year,
              revenue: increment(v.revenue),
              orders: increment(v.orders),
            },
            { merge: true },
          ),
        );
      }); // G. productStats

      Object.entries(prodStats).forEach(([pid, v]) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "productStats", pid),
            {
              title: v.title,
              category: v.category || "general",
              totalOrders: increment(v.totalOrders),
              totalRevenue: increment(v.totalRevenue),
              totalQuantity: increment(v.totalQuantity),
              lastSoldAt: Timestamp.fromDate(v.lastSoldAt),
            },
            { merge: true },
          ),
        );
      }); // C. customerStats

      Object.entries(custStats).forEach(([uid, v]) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "customerStats", uid),
            {
              name: v.name,
              email: v.email,
              totalOrders: increment(v.totalOrders),
              totalSpent: increment(v.totalSpent),
              avgOrderValue: Math.round(v.totalSpent / v.totalOrders),
              lastOrderDate: Timestamp.fromDate(v.lastOrderDate),
            },
            { merge: true },
          ),
        );
      }); // B. product stock decrement (aggregated)

      Object.entries(stockDec).forEach(([pid, qty]) => {
        ops.push((b) =>
          b.update(doc(fireDB, "products", pid), { stock: increment(-qty) }),
        );
      }); // I. clear carts for touched users

      cartUsers.forEach((uid) => {
        ops.push((b) =>
          b.set(
            doc(fireDB, "carts", uid),
            { items: [], updatedAt: serverTimestamp() },
            { merge: true },
          ),
        );
      });

      log(`Committing ${ops.length} operations in batches of ${BATCH_CHUNK}…`);
      await commitOps(ops, setProgress);
      setProgress(100);
      const dist = orders.reduce((a, o) => {
        a[o.status] = (a[o.status] || 0) + 1;
        return a;
      }, {});
      log(
        ` Seeded ${ORDER_COUNT} orders across ${Object.keys(daily).length} days.`,
      );
      log(
        `Flow: delivered ${dist.delivered || 0} · shipped ${dist.shipped || 0} · confirmed ${dist.confirmed || 0} · placed ${dist.placed || 0}`,
      );
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR seeding: ${err.message}`);
    } finally {
      setSeeding(false);
    }
  }; /* ============================================================
     STEP 6 — DELETE SEEDED DATA
  ============================================================ */

  const deleteSeeded = async () => {
    setError("");
    setDeleting(true);
    setProgress(0);
    try {
      log("Querying seeded top-level orders…");
      const orderSnap = await getDocs(
        query(collection(fireDB, "orders"), where("_seeded", "==", true)),
      );

      log("Querying seeded orders in user subcollections…");
      const usersSnap = await getDocs(collection(fireDB, "users"));
      const subRefs = [];
      for (const u of usersSnap.docs) {
        const subSnap = await getDocs(
          collection(fireDB, "users", u.id, "orders"),
        );
        subSnap.forEach((d) => {
          if (d.data()._seeded) subRefs.push(d.ref);
        });
      }

      log("Querying seeded inventory logs…");
      const logSnap = await getDocs(
        query(
          collection(fireDB, "inventoryLogs"),
          where("_seeded", "==", true),
        ),
      );

      const refs = [
        ...orderSnap.docs.map((d) => d.ref),
        ...subRefs,
        ...logSnap.docs.map((d) => d.ref),
      ];
      if (refs.length === 0) {
        log("Nothing to delete — no seeded documents found.");
        setProgress(100);
        return;
      }

      log(
        `Deleting ${orderSnap.size} top-level + ${subRefs.length} subcollection orders + ${logSnap.size} inventory logs…`,
      );
      const ops = refs.map((ref) => (b) => b.delete(ref));
      await commitOps(ops, setProgress);
      setProgress(100);
      log(` Deleted ${refs.length} seeded documents.`);
      log(
        "Note: customerStats / analytics / productStats are NOT rolled back (same as a real order system).",
      );
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR deleting: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }; /* ============================================================
     MAINTENANCE — BACKFILL MISSING USER STATUS
     One-time: sets status:"active" on any /users doc that lacks the field,
     so legacy accounts match new signups (which now write status at creation).
  ============================================================ */

  const backfillUserStatus = async () => {
    setError("");
    setBackfilling(true);
    setProgress(0);
    try {
      log("Scanning users for missing status…");
      const snap = await getDocs(collection(fireDB, "users"));
      const missing = snap.docs.filter((d) => {
        const s = d.data().status;
        return s === undefined || s === null || s === "";
      });
      if (missing.length === 0) {
        log(
          `All ${snap.size} users already have a status — nothing to backfill.`,
        );
        setProgress(100);
        return;
      }
      log(
        `Backfilling status:"active" on ${missing.length} of ${snap.size} users…`,
      );
      const ops = missing.map(
        (d) => (b) => b.update(d.ref, { status: "active" }),
      );
      await commitOps(ops, setProgress);
      setProgress(100);
      log(` Backfilled ${missing.length} users with status:"active".`);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR backfilling: ${err.message}`);
    } finally {
      setBackfilling(false);
    }
  }; /* ============================================================
     UPLOAD DASHBOARD SAMPLE DATA — seed + remove
     Populates uploadSessions + activityLog (read by /admin/adminUploadOrders).
     Every doc is tagged _seeded:true so removal targets only these.
  ============================================================ */

  const seedUploadData = async () => {
    setError("");
    setSeedingUploads(true);
    setProgress(0);
    try {
      log("Building sample upload sessions + activity…");
      const now = Date.now();
      const ops = [];
      SAMPLE_SESSIONS.forEach((s, i) => {
        // First two land "today" so the dashboard's Today's Imports KPI is non-zero.
        const created = new Date(
          now -
            (i < 2
              ? randInt(1, 8) * 3600000
              : randInt(1, 6) * 86400000 + randInt(0, 12) * 3600000),
        );
        const ref = doc(collection(fireDB, "uploadSessions"));
        ops.push((b) =>
          b.set(ref, {
            fileName: s.fileName,
            fileSize: s.recordCount * 700 + randInt(2000, 90000),
            status: s.status,
            uploadedBy: "Alex Rivera",
            createdAt: Timestamp.fromDate(created),
            recordCount: s.recordCount,
            successCount: s.successCount,
            failCount: s.failCount,
            _seeded: true,
          }),
        );
      });
      SAMPLE_ACTIVITY.forEach((a, i) => {
        const ts = new Date(now - i * randInt(20, 90) * 60000);
        const ref = doc(collection(fireDB, "activityLog"));
        ops.push((b) =>
          b.set(ref, {
            event: a.event,
            actor: a.actor,
            timestamp: Timestamp.fromDate(ts),
            type: a.type,
            _seeded: true,
          }),
        );
      });
      log(`Committing ${ops.length} sample docs…`);
      await commitOps(ops, setProgress);
      setProgress(100);
      log(
        ` Seeded ${SAMPLE_SESSIONS.length} upload sessions + ${SAMPLE_ACTIVITY.length} activity entries.`,
      );
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR seeding upload data: ${err.message}`);
    } finally {
      setSeedingUploads(false);
    }
  };

  const removeUploadData = async () => {
    setError("");
    setRemovingUploads(true);
    setProgress(0);
    try {
      log("Querying seeded upload data…");
      const refs = [];
      for (const c of ["uploadSessions", "activityLog", "importAnalytics"]) {
        const snap = await getDocs(
          query(collection(fireDB, c), where("_seeded", "==", true)),
        );
        snap.forEach((d) => refs.push(d.ref));
      }
      if (refs.length === 0) {
        log("Nothing to remove — no seeded upload data found.");
        setProgress(100);
        return;
      }
      log(`Deleting ${refs.length} seeded upload docs…`);
      const ops = refs.map((ref) => (b) => b.delete(ref));
      await commitOps(ops, setProgress);
      setProgress(100);
      log(` Removed ${refs.length} seeded upload docs.`);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      log(`ERROR removing upload data: ${err.message}`);
    } finally {
      setRemovingUploads(false);
    }
  }; /* ============================================================
     UI
  ============================================================ */

  const showProgress =
    (seeding || deleting || backfilling || seedingUploads || removingUploads) &&
    progress > 0;

  return (
    <div
      style={{
        background: "#0f172a",
        minHeight: "100vh",
        color: "#fff",
        fontFamily: "Inter, sans-serif",
      }}
    >
           {" "}
      <div className="max-w-3xl mx-auto px-6 py-12">
                {/* Header */}       {" "}
        <div
          className="rounded-2xl p-6 mb-6"
          style={{ background: "#1B1C1C", border: "1px solid #44474C" }}
        >
                   {" "}
          <h1 className="text-2xl font-black"> Firebase Test Data Generator</h1>
                   {" "}
          <p className="text-sm mt-1" style={{ color: "#74777D" }}>
                        Seeds {ORDER_COUNT} realistic orders across the past
            ~1.5 years into every collection an order touches. Admin-only
            utility.          {" "}
          </p>
                 {" "}
        </div>
                {/* Status box */}       {" "}
        <div className="grid grid-cols-2 gap-4 mb-6">
                   {" "}
          <div
            className="rounded-xl p-4"
            style={{ background: "#1B1C1C", border: "1px solid #44474C" }}
          >
                       {" "}
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: "#74777D" }}
            >
              Users loaded
            </p>
                       {" "}
            <p className="text-2xl font-bold" style={{ color: "#A43B31" }}>
              {users.length}
            </p>
                     {" "}
          </div>
                   {" "}
          <div
            className="rounded-xl p-4"
            style={{ background: "#1B1C1C", border: "1px solid #44474C" }}
          >
                       {" "}
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: "#74777D" }}
            >
              Products loaded
            </p>
                       {" "}
            <p className="text-2xl font-bold" style={{ color: "#A43B31" }}>
              {products.length}
            </p>
                     {" "}
          </div>
                 {" "}
        </div>
                {/* Error */}       {" "}
        {error && (
          <div
            className="rounded-xl p-4 mb-6 text-sm"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid #ef4444",
              color: "#fca5a5",
            }}
          >
                        {error}         {" "}
          </div>
        )}
                {/* Buttons */}       {" "}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
                   {" "}
          <button
            onClick={loadData}
            disabled={busy}
            className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
            style={{
              background: loadingData ? "#44474C" : "#44474C",
              color: "#fff",
              opacity: busy && !loadingData ? 0.5 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
                        {loadingData ? "Loading…" : "Load Firebase Data"}       
             {" "}
          </button>
                   {" "}
          <button
            onClick={generateOrders}
            disabled={busy || !dataLoaded}
            className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
            style={{
              background: "#A43B31",
              color: "#fff",
              opacity: busy || !dataLoaded ? 0.5 : 1,
              cursor: busy || !dataLoaded ? "not-allowed" : "pointer",
            }}
          >
                       {" "}
            {seeding ? `Generating… ${progress}%` : "Generate 500 Test Orders"} 
                   {" "}
          </button>
                   {" "}
          <button
            onClick={deleteSeeded}
            disabled={busy}
            className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
            style={{
              background: "#7f1d1d",
              color: "#fff",
              opacity: busy ? 0.5 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
                       {" "}
            {deleting ? `Deleting… ${progress}%` : "Delete All Seeded Orders"} 
                   {" "}
          </button>
                 {" "}
        </div>
                {/* Maintenance — one-time backfill */}       {" "}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
                   {" "}
          <button
            onClick={backfillUserStatus}
            disabled={busy}
            className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
            style={{
              background: "#065f46",
              color: "#fff",
              opacity: busy ? 0.5 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
                       {" "}
            {backfilling
              ? `Backfilling… ${progress}%`
              : 'Backfill Missing User Status → "active"'}
                     {" "}
          </button>
                 {" "}
        </div>
                {/* Upload dashboard sample data — seed + remove */}       {" "}
        <div
          className="rounded-xl p-4 mb-6"
          style={{ background: "#1B1C1C", border: "1px solid #44474C" }}
        >
                   {" "}
          <p className="text-sm font-semibold mb-1">
            Upload Dashboard Sample Data
          </p>
                   {" "}
          <p className="text-xs mb-3" style={{ color: "#74777D" }}>
                        Populates{" "}
            <code style={{ color: "#F6F3F2" }}>uploadSessions</code> +{" "}
            <code style={{ color: "#F6F3F2" }}>activityLog</code> so the Bulk
            Order Import page (/admin/adminUploadOrders) shows History,
            Analytics and Activity. Tagged{" "}
            <code style={{ color: "#F6F3F2" }}>_seeded:true</code>.        
             {" "}
          </p>
                   {" "}
          <div className="flex flex-col sm:flex-row gap-3">
                       {" "}
            <button
              onClick={seedUploadData}
              disabled={busy}
              className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
              style={{
                background: "#A43B31",
                color: "#fff",
                opacity: busy ? 0.5 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
                           {" "}
              {seedingUploads
                ? `Seeding… ${progress}%`
                : "Seed Upload Sessions + Activity"}
                         {" "}
            </button>
                       {" "}
            <button
              onClick={removeUploadData}
              disabled={busy}
              className="flex-1 rounded-xl px-5 py-3 font-semibold transition-colors"
              style={{
                background: "#7f1d1d",
                color: "#fff",
                opacity: busy ? 0.5 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
                           {" "}
              {removingUploads
                ? `Removing… ${progress}%`
                : "Remove Seeded Upload Data"}
                         {" "}
            </button>
                     {" "}
          </div>
                 {" "}
        </div>
                {/* Progress bar */}       {" "}
        {showProgress && (
          <div
            className="rounded-full overflow-hidden mb-6"
            style={{ height: "10px", background: "#44474C" }}
          >
                       {" "}
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background:
                  deleting || removingUploads
                    ? "#ef4444"
                    : backfilling
                      ? "#10b981"
                      : seedingUploads
                        ? "#A43B31"
                        : "#A43B31",
                transition: "width 0.2s",
              }}
            />
                     {" "}
          </div>
        )}
                {/* Note */}       {" "}
        <div
          className="rounded-xl p-4 mb-6 text-xs"
          style={{
            background: "#1B1C1C",
            border: "1px solid #44474C",
            color: "#74777D",
          }}
        >
                    Delete removes seeded{" "}
          <code style={{ color: "#F6F3F2" }}>orders</code> and{" "}
          <code style={{ color: "#F6F3F2" }}>inventoryLogs</code> (tagged{" "}
          <code style={{ color: "#F6F3F2" }}>_seeded: true</code>). Aggregate
          collections — <code style={{ color: "#F6F3F2" }}>customerStats</code>,{" "}
          <code style={{ color: "#F6F3F2" }}>analytics</code>,{" "}
          <code style={{ color: "#F6F3F2" }}>productStats</code> — and product
          stock are NOT rolled back, mirroring how a real order system never
          reverses historical aggregates.        {" "}
        </div>
                {/* Log panel */}       {" "}
        <div
          className="rounded-xl p-4"
          style={{ background: "#020617", border: "1px solid #44474C" }}
        >
                   {" "}
          <p
            className="text-xs uppercase tracking-wide mb-2"
            style={{ color: "#74777D" }}
          >
            Activity log (last 20)
          </p>
                   {" "}
          <div
            className="font-mono text-xs flex flex-col gap-1"
            style={{ maxHeight: "260px", overflowY: "auto" }}
          >
                       {" "}
            {logs.length === 0 ? (
              <span style={{ color: "#44474C" }}>No activity yet.</span>
            ) : (
              logs.map((l, i) => (
                <span
                  key={i}
                  style={{
                    color: l.includes("ERROR")
                      ? "#fca5a5"
                      : l.includes(" ") || l.includes(" ")
                        ? "#86efac"
                        : "#cbd5e1",
                  }}
                >
                  {l}
                </span>
              ))
            )}
                     {" "}
          </div>
                 {" "}
        </div>
             {" "}
      </div>
         {" "}
    </div>
  );
};

export default TestingPage;
