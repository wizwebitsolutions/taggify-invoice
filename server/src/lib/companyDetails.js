/**
 * Taggify's own details, as printed on every generated invoice (user's
 * sample "Sindhal Technologies Private Limited PI 76.pdf", 12 Sep —
 * letterhead, GSTIN/PAN, bank block, HSN/SAC). Env-overridable so a
 * change of bank/address never needs a code change; the defaults are the
 * values on that sample.
 *
 * `logoPath`: an optional PNG/JPG to draw in place of the text wordmark
 * (the sample has an image logo + a signature image that aren't
 * extractable from the PDF — drop the files in and point these at them).
 */
export const COMPANY = {
  name: process.env.COMPANY_NAME ?? "Taggify Pvt Ltd",
  wordmark: process.env.COMPANY_WORDMARK ?? "TAGGIFY",
  tagline: process.env.COMPANY_TAGLINE ?? "Creative Marketing & Media Solutions",
  address: process.env.COMPANY_ADDRESS ?? "Building No: 65, Sector-12, Panipat, Haryana - India",
  gstin: process.env.COMPANY_GSTIN ?? "06AAKCT7010Q1ZW",
  pan: process.env.COMPANY_PAN ?? "AAKCT7010Q",
  email: process.env.COMPANY_EMAIL ?? "finance@taggify.in",
  bank: {
    name: process.env.COMPANY_BANK_NAME ?? "Axis Bank",
    holder: process.env.COMPANY_BANK_HOLDER ?? "Taggify Pvt Ltd",
    account: process.env.COMPANY_BANK_ACCOUNT ?? "923020061815304",
    ifsc: process.env.COMPANY_BANK_IFSC ?? "UTIB0000240",
  },
  // SAC 998397 — "Sponsorship services & brand promotion services", the
  // code on the sample.
  sac: process.env.COMPANY_SAC ?? "998397",
  logoPath: process.env.COMPANY_LOGO_PATH ?? null,
  signaturePath: process.env.COMPANY_SIGNATURE_PATH ?? null,
};
