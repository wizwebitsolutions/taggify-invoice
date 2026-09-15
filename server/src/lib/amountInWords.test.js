import { describe, it, expect } from "vitest";
import { amountInWords, integerInWords } from "./amountInWords.js";

describe("amountInWords — Indian numbering, as on the sample invoice", () => {
  it("matches the sample: 41,300 → FORTY ONE THOUSAND THREE HUNDRED", () => {
    expect(amountInWords(41300)).toBe("INR FORTY ONE THOUSAND THREE HUNDRED ONLY");
  });

  it.each([
    [0, "ZERO"],
    [7, "SEVEN"],
    [19, "NINETEEN"],
    [20, "TWENTY"],
    [99, "NINETY NINE"],
    [100, "ONE HUNDRED"],
    [1000, "ONE THOUSAND"],
    [12500, "TWELVE THOUSAND FIVE HUNDRED"],
    [100000, "ONE LAKH"],
    [2950000, "TWENTY NINE LAKH FIFTY THOUSAND"],
    [10000000, "ONE CRORE"],
    [123456789, "TWELVE CRORE THIRTY FOUR LAKH FIFTY SIX THOUSAND SEVEN HUNDRED EIGHTY NINE"],
  ])("%i → %s", (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it("spells out paise when present", () => {
    expect(amountInWords("29500.50")).toBe("INR TWENTY NINE THOUSAND FIVE HUNDRED AND FIFTY PAISE ONLY");
  });
});
