import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS,
  getEffectivePermissions,
  hasPermission,
  isRestrictedSubAdmin,
  sanitizePermissionsInput,
  computeNewAccountOverlay,
  clampPatchToActor,
} from "./permissions.js";

describe("getEffectivePermissions — role defaults merged with a sub-admin overlay (newTask.md, 8 Sep)", () => {
  it("gives a plain ADMIN account every permission, with no overlay", () => {
    const effective = getEffectivePermissions({ role: "ADMIN", permissions: null });
    for (const key of PERMISSION_KEYS) expect(effective[key]).toBe(true);
  });

  it("lets an overlay turn individual keys off without touching the rest", () => {
    const effective = getEffectivePermissions({ role: "ADMIN", permissions: { "campaigns.manage": false } });
    expect(effective["campaigns.manage"]).toBe(false);
    for (const key of PERMISSION_KEYS.filter((k) => k !== "campaigns.manage")) {
      expect(effective[key]).toBe(true);
    }
  });

  it("gives every non-ADMIN role every key false with no overlay", () => {
    for (const role of ["CREATOR", "TEAM_MEMBER", "FINANCE", "PLAN_MAKER"]) {
      const effective = getEffectivePermissions({ role, permissions: null });
      for (const key of PERMISSION_KEYS) expect(effective[key]).toBe(false);
    }
  });

  it("lets an overlay grant a non-ADMIN role an individual key without touching the rest (15 Sep — admin can give any user access)", () => {
    const effective = getEffectivePermissions({ role: "FINANCE", permissions: { "finance.manage": true } });
    expect(effective["finance.manage"]).toBe(true);
    expect(effective["campaigns.manage"]).toBe(false);
  });
});

describe("hasPermission", () => {
  it("true for a plain admin, false for a restricted one", () => {
    expect(hasPermission({ role: "ADMIN", permissions: null }, "inventory.manage")).toBe(true);
    expect(hasPermission({ role: "ADMIN", permissions: { "inventory.manage": false } }, "inventory.manage")).toBe(false);
  });
});

describe("isRestrictedSubAdmin", () => {
  it("false for a plain ADMIN with no overlay", () => {
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: null })).toBe(false);
  });

  it("false for a non-ADMIN role even with a permissions blob set", () => {
    expect(isRestrictedSubAdmin({ role: "PLAN_MAKER", permissions: { "plans.manage": false } })).toBe(false);
  });

  it("true only once an ADMIN's overlay actually turns something off", () => {
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: {} })).toBe(false);
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: { "users.manage": false } })).toBe(true);
  });
});

describe("computeNewAccountOverlay — new-account grant can never exceed the actor's own (privilege-escalation guard)", () => {
  const fullAdmin = { role: "ADMIN", permissions: null };
  const restrictedAdmin = { role: "ADMIN", permissions: { "campaigns.manage": false } };

  describe("defaultGrant=true — new ADMIN accounts (plain admin's normal experience)", () => {
    it("an unrestricted actor's overlay passes through unchanged, minimally stored", () => {
      expect(computeNewAccountOverlay(fullAdmin, {}, true)).toEqual({});
      expect(computeNewAccountOverlay(fullAdmin, { "plans.manage": false }, true)).toEqual({ "plans.manage": false });
    });

    it("forces a key the actor lacks to false even when the request doesn't mention it at all", () => {
      // The exact escalation this guards: omitting `permissions` used to mean
      // "full grant" regardless of who was asking.
      expect(computeNewAccountOverlay(restrictedAdmin, {}, true)).toEqual({ "campaigns.manage": false });
    });

    it("forces a key the actor lacks to false even when the request explicitly asks for true", () => {
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.manage": true }, true)).toEqual({ "campaigns.manage": false });
    });

    it("still grants a key the actor does hold, even when it's not the default", () => {
      const result = computeNewAccountOverlay(restrictedAdmin, { "finance.manage": false }, true);
      expect(result).toEqual({ "campaigns.manage": false, "finance.manage": false });
    });
  });

  describe("defaultGrant=false — new non-ADMIN accounts (15 Sep — admin can give any user access)", () => {
    it("an unmentioned key stays false — no accidental grant just from omitting `permissions`", () => {
      expect(computeNewAccountOverlay(fullAdmin, {}, false)).toEqual({});
    });

    it("an unrestricted actor's requested grant passes through, stored as a minimal true-only overlay", () => {
      expect(computeNewAccountOverlay(fullAdmin, { "inventory.manage": true }, false)).toEqual({ "inventory.manage": true });
    });

    it("a restricted actor can't grant a key they don't hold themselves", () => {
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.manage": true }, false)).toEqual({});
    });

    it("a restricted actor can still grant a key they do hold", () => {
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.manage": true, "finance.manage": true }, false)).toEqual({
        "finance.manage": true,
      });
    });
  });
});

describe("clampPatchToActor — an edit can never grant a key the editor doesn't hold (privilege-escalation guard)", () => {
  const fullAdmin = { role: "ADMIN", permissions: null };
  const restrictedAdmin = { role: "ADMIN", permissions: { "finance.manage": false } };

  it("an unrestricted actor's patch passes through unchanged", () => {
    expect(clampPatchToActor(fullAdmin, { "campaigns.manage": true, "plans.manage": false })).toEqual({
      "campaigns.manage": true,
      "plans.manage": false,
    });
  });

  it("forces a patched `true` down to false when the actor lacks that key", () => {
    expect(clampPatchToActor(restrictedAdmin, { "finance.manage": true })).toEqual({ "finance.manage": false });
  });

  it("a patched `false` passes through regardless — restricting further is always allowed", () => {
    expect(clampPatchToActor(restrictedAdmin, { "campaigns.manage": false })).toEqual({ "campaigns.manage": false });
  });

  it("doesn't touch keys absent from the patch — an untouched key isn't re-derived from the actor's own grant", () => {
    // Only `plans.manage` is being set; `finance.manage` (which the actor
    // themselves lacks) must not appear in the output just because the
    // actor happens to be restricted there — that would silently strip an
    // unrelated pre-existing grant on the target.
    const result = clampPatchToActor(restrictedAdmin, { "plans.manage": true });
    expect(result).toEqual({ "plans.manage": true });
    expect(result).not.toHaveProperty("finance.manage");
  });
});

describe("sanitizePermissionsInput", () => {
  it("drops unknown keys and non-boolean values", () => {
    const clean = sanitizePermissionsInput({ "campaigns.manage": false, notAKey: true, "plans.manage": "yes" });
    expect(clean).toEqual({ "campaigns.manage": false });
  });

  it("returns null for non-object input", () => {
    expect(sanitizePermissionsInput(null)).toBeNull();
    expect(sanitizePermissionsInput(undefined)).toBeNull();
  });
});
