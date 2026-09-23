// Transactional email via Resend's HTTP API (email 2FA, 21 Sep). Plain
// fetch — one endpoint doesn't justify the SDK as a dependency.
//
// Without RESEND_API_KEY: outside production the code is printed to the
// server console instead, so local dev and a fresh clone work with no
// account; in production it's a hard 503 — silently "sending" nothing would
// lock every verified user out with no clue why.
import { ApiError } from "../middleware/errorHandler.js";

const RESEND_URL = "https://api.resend.com/emails";
// tasks.md (23 Sep #2): OTPs go out from noreply@taggify.in — the domain is
// verified in Resend. EMAIL_FROM overrides it per environment.
export const DEFAULT_EMAIL_FROM = "Taggify <noreply@taggify.in>";

export async function sendOtpEmail({ to, code, purpose, expiresInMinutes }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "Email delivery isn't configured — contact your admin");
    }
    console.log(`[mailer] RESEND_API_KEY not set — OTP for ${to} (${purpose}): ${code}`);
    return;
  }

  const subject = purpose === "LOGIN" ? `${code} is your Taggify sign-in code` : `${code} is your Taggify email verification code`;
  const intro = purpose === "LOGIN" ? "Use this code to finish signing in to Taggify:" : "Use this code to verify this email address for your Taggify account:";

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      to: [to],
      subject,
      text: `${intro}\n\n${code}\n\nIt expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#18181b"><p>${intro}</p><p style="font-size:30px;font-weight:600;letter-spacing:6px;margin:24px 0">${code}</p><p style="color:#71717a">It expires in ${expiresInMinutes} minutes. If you didn't request this, you can ignore this email.</p></div>`,
    }),
  });

  if (!res.ok) {
    // Resend's body says why (unverified sender domain, bad key, ...) — log
    // it server-side; the client only needs to know the send failed.
    console.error(`[mailer] Resend ${res.status}: ${await res.text().catch(() => "")}`);
    throw new ApiError(502, "EMAIL_SEND_FAILED", "Couldn't send the verification email — try again in a moment");
  }
}
