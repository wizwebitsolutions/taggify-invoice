/**
 * "INR FORTY ONE THOUSAND THREE HUNDRED ONLY" — the "Tax Amount (in words)"
 * line on the invoice PDF (user's sample, 12 Sep). Indian numbering
 * (lakh/crore), rupees and paise, upper-cased like the sample.
 */
const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function belowThousand(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

export function integerInWords(n) {
  if (n === 0) return "ZERO";
  const parts = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerInWords(crore)} CRORE`);
  if (lakh) parts.push(`${belowThousand(lakh)} LAKH`);
  if (thousand) parts.push(`${belowThousand(thousand)} THOUSAND`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

export function amountInWords(amount) {
  const total = Math.round(Number(amount) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  let words = `INR ${integerInWords(rupees)}`;
  if (paise) words += ` AND ${integerInWords(paise)} PAISE`;
  return `${words} ONLY`;
}
