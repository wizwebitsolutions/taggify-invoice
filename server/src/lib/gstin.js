import { COMPANY } from "./companyDetails.js";

// Same shape the client checks (VALIDATORS.gstin in form-field.tsx): 2-digit
// state code, 10-char PAN, entity code, "Z", check character.
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Which GST heads an invoice from Taggify to `clientGstin` carries (user
 * request, 21 Sep — "compare by gst no. of client and our gst"). The first
 * two digits of a GSTIN are the state code: same state as ours → the rate
 * splits into CGST + SGST (half each); any other state → IGST at the full
 * rate. No/unreadable GSTIN falls back to IGST, what every PI printed
 * before this existed.
 */
export function gstSplitFor(clientGstin, ourGstin = COMPANY.gstin) {
  const theirs = String(clientGstin ?? "").trim().slice(0, 2);
  const ours = String(ourGstin ?? "").trim().slice(0, 2);
  return /^\d{2}$/.test(theirs) && theirs === ours ? "CGST_SGST" : "IGST";
}
