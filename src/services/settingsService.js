import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { fireDB } from "../context/FirebaseConfig";

/**
 * Reads payment gateway configurations from settings/paymentSettings document.
 * Returns defaults if document does not exist.
 */
export const getPaymentSettings = async () => {
  const docRef = doc(fireDB, "settings", "paymentSettings");
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data();
  }
  return {
    whatsappPayment: true,
    razorpayPayment: true,
  };
};

/**
 * Saves payment settings to settings/paymentSettings document in Firestore.
 */
export const savePaymentSettings = async (settings) => {
  const docRef = doc(fireDB, "settings", "paymentSettings");
  await setDoc(docRef, {
    whatsappPayment: !!settings.whatsappPayment,
    razorpayPayment: !!settings.razorpayPayment,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/**
 * Reads invoice customization details from settings/invoiceSettings document.
 * Returns empty/default values if document does not exist.
 */
export const getInvoiceSettings = async () => {
  const docRef = doc(fireDB, "settings", "invoiceSettings");
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data();
  }
  return {
    companyName: "Nexus Commerce Pvt. Ltd.",
    address: "12 Industrial Layout, Whitefield, Bengaluru, Karnataka 560066",
    mobile: "+91 80 4000 1234",
    email: "support@nexuscommerce.in",
    gstin: "29ABCDE1234F1Z5",
    website: "https://nexuscommerce.in",
    footerTitle: "Thank You!",
    footerSubNote: "We appreciate your business. Visit Again.",
    supportEmail: "support@nexuscommerce.in",
    supportPhone: "+91 80 4000 1234",
    upiId: "",
    logo: "",
  };
};

/**
 * Saves invoice customization details to settings/invoiceSettings document in Firestore.
 */
export const saveInvoiceSettings = async (settings) => {
  const docRef = doc(fireDB, "settings", "invoiceSettings");
  await setDoc(docRef, {
    companyName: (settings.companyName || "").trim(),
    address: (settings.address || "").trim(),
    mobile: (settings.mobile || "").trim(),
    email: (settings.email || "").trim(),
    gstin: (settings.gstin || "").trim(),
    website: (settings.website || "").trim(),
    footerTitle: (settings.footerTitle || "Thank You!").trim(),
    footerSubNote: (settings.footerSubNote || "").trim(),
    supportEmail: (settings.supportEmail || "").trim(),
    supportPhone: (settings.supportPhone || "").trim(),
    upiId: (settings.upiId || "").trim(),
    logo: (settings.logo || "").trim(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/**
 * Reads shipping estimate settings from settings/shippingSettings document.
 * Returns defaults (threshold: 500, cost: 49) if document does not exist.
 */
export const getShippingSettings = async () => {
  const docRef = doc(fireDB, "settings", "shippingSettings");
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data();
  }
  return {
    freeShippingThreshold: 500,
    shippingCost: 49,
  };
};

/**
 * Saves shipping estimate settings to settings/shippingSettings document in Firestore.
 */
export const saveShippingSettings = async (settings) => {
  const docRef = doc(fireDB, "settings", "shippingSettings");
  await setDoc(docRef, {
    freeShippingThreshold: Number(settings.freeShippingThreshold) || 500,
    shippingCost: Number(settings.shippingCost) || 49,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};
