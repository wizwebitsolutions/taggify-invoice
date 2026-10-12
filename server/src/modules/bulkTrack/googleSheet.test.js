import { describe, it, expect, afterEach } from "vitest";

import { parseServiceAccountKey, serviceAccount, parseSheetUrl } from "./googleSheet.js";

// GOOGLE_SERVICE_ACCOUNT_KEY (12 Oct) — the single env var the source repo
// (affiliate-creator-tool) uses: the whole service-account JSON, raw or
// base64, with the usual hosting-dashboard manglings repaired. Fake key only.
const KEY = { type: "service_account", client_email: "bulk@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" };
const RAW = JSON.stringify(KEY);
const EXPECTED = { clientEmail: KEY.client_email, privateKey: KEY.private_key };

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["GOOGLE_SERVICE_ACCOUNT_KEY", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("parseServiceAccountKey", () => {
  it("reads raw JSON and base64-encoded JSON", () => {
    expect(parseServiceAccountKey(RAW)).toEqual(EXPECTED);
    expect(parseServiceAccountKey(Buffer.from(RAW).toString("base64"))).toEqual(EXPECTED);
  });

  it("repairs a quoted paste, dropped outer braces, and a double-escaped private key", () => {
    expect(parseServiceAccountKey(`'${RAW}'`)).toEqual(EXPECTED);
    expect(parseServiceAccountKey(RAW.slice(1, -1))).toEqual(EXPECTED);
    const doubleEscaped = RAW.replace(/\\n/g, "\\\\n");
    expect(parseServiceAccountKey(doubleEscaped)).toEqual(EXPECTED);
  });

  it("explains a bad or incomplete key", () => {
    expect(() => parseServiceAccountKey("{not json")).toThrow(/isn't valid JSON/);
    expect(() => parseServiceAccountKey(JSON.stringify({ client_email: "x" }))).toThrow(/missing client_email\/private_key/);
  });
});

describe("serviceAccount — which env wins", () => {
  it("GOOGLE_SERVICE_ACCOUNT_KEY is used when set, even if the email/private-key pair is too", () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = RAW;
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "other@x.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "other";
    expect(serviceAccount()).toEqual(EXPECTED);
  });

  it("falls back to the finance export's email + private key", () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "fin@x.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "line1\\nline2";
    expect(serviceAccount()).toEqual({ clientEmail: "fin@x.com", privateKey: "line1\nline2" });
  });

  it("says what to set when neither is configured", () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    expect(() => serviceAccount()).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY/);
  });
});

describe("parseSheetUrl", () => {
  it("reads the spreadsheet id and the tab gid (null when absent)", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/abc-123_X/edit?gid=42#gid=42")).toEqual({ sheetId: "abc-123_X", gid: "42" });
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit")).toEqual({ sheetId: "abc", gid: null });
  });
});
