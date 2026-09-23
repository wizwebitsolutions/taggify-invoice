import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS,
  SECTIONS,
  ROLE_DEFAULTS,
  LEGACY_KEY_MAP,
  getEffectivePermissions,
  hasPermission,
  isRestrictedSubAdmin,
  sanitizePermissionsInput,
  computeNewAccountOverlay,
  clampPatchToActor,
  expandLegacyOverlay,
  applyViewImplication,
  isFullAdmin,
  isGrantableRole,
  assertGrantableRole,
} from "./permissions.js";
import { ApiError } from "../middleware/errorHandler.js";

describe("key model (23 Sep — per-action keys)", () => {
  it("has one key per section × action, every one shaped <section>.<action>", () => {
    expect(PERMISSION_KEYS).toHaveLength(17);
    for (const key of PERMISSION_KEYS) {
      const [section, action] = key.split(".");
      expect(SECTIONS[section]).toContain(action);
    }
    expect(PERMISSION_KEYS).toContain("finance.pay");
    expect(PERMISSION_KEYS).not.toContain("users.pay");
  });

  it("every legacy key maps onto real keys only", () => {
    for (const keys of Object.values(LEGACY_KEY_MAP)) for (const key of keys) expect(PERMISSION_KEYS).toContain(key);
  });
});

describe("getEffectivePermissions — role baseline merged with the overlay", () => {
  it("gives a plain ADMIN account every permission, with no overlay", () => {
    const effective = getEffectivePermissions({ role: "ADMIN", permissions: null });
    for (const key of PERMISSION_KEYS) expect(effective[key]).toBe(true);
  });

  it("lets an overlay turn individual keys off without touching the rest", () => {
    const effective = getEffectivePermissions({ role: "ADMIN", permissions: { "campaigns.edit": false } });
    expect(effective["campaigns.edit"]).toBe(false);
    expect(effective["campaigns.view"]).toBe(true);
    for (const key of PERMISSION_KEYS.filter((k) => k !== "campaigns.edit")) expect(effective[key]).toBe(true);
  });

  it("FINANCE's baseline is what the role could already do: finance view/edit/approve/pay + read campaigns, pages, links", () => {
    const effective = getEffectivePermissions({ role: "FINANCE", permissions: null });
    for (const key of ["finance.view", "finance.edit", "finance.approve", "finance.pay", "campaigns.view", "inventory.view", "links.view"]) expect(effective[key]).toBe(true);
    for (const key of ["users.view", "users.edit", "campaigns.edit", "inventory.edit", "inventory.approve", "links.edit", "links.approve", "plans.view", "plans.edit", "plans.approve"]) expect(effective[key]).toBe(false);
  });

  it("PLAN_MAKER reads Inventory only; CREATOR / TEAM_MEMBER get nothing", () => {
    const pm = getEffectivePermissions({ role: "PLAN_MAKER", permissions: null });
    expect(pm["inventory.view"]).toBe(true);
    for (const key of PERMISSION_KEYS.filter((k) => k !== "inventory.view")) expect(pm[key]).toBe(false);
    for (const role of ["CREATOR", "TEAM_MEMBER"]) {
      const effective = getEffectivePermissions({ role, permissions: null });
      for (const key of PERMISSION_KEYS) expect(effective[key]).toBe(false);
    }
    expect(ROLE_DEFAULTS.CREATOR).toEqual(ROLE_DEFAULTS.TEAM_MEMBER);
  });

  it("lets an overlay grant a non-ADMIN role an individual key without touching the rest", () => {
    const effective = getEffectivePermissions({ role: "PLAN_MAKER", permissions: { "campaigns.edit": true } });
    expect(effective["campaigns.edit"]).toBe(true);
    expect(effective["campaigns.view"]).toBe(true); // implied
    expect(effective["links.view"]).toBe(false);
  });

  it("edit / approve / pay each imply their section's view, even if the overlay says view=false", () => {
    const effective = getEffectivePermissions({ role: "ADMIN", permissions: { "finance.view": false, "finance.pay": true } });
    expect(effective["finance.view"]).toBe(true);
    expect(applyViewImplication({ "links.approve": true })["links.view"]).toBe(true);
    expect(applyViewImplication({ "links.view": false })["links.view"]).toBe(false);
  });

  it("still honours a legacy six-key overlay stored before the split", () => {
    const sub = getEffectivePermissions({ role: "ADMIN", permissions: { "finance.manage": false } });
    for (const key of LEGACY_KEY_MAP["finance.manage"]) expect(sub[key]).toBe(false);
    expect(sub["plans.edit"]).toBe(true);

    const granted = getEffectivePermissions({ role: "PLAN_MAKER", permissions: { "links.review": true } });
    for (const key of LEGACY_KEY_MAP["links.review"]) expect(granted[key]).toBe(true);
  });
});

describe("expandLegacyOverlay", () => {
  it("expands old keys and lets a new key present alongside win", () => {
    expect(expandLegacyOverlay({ "users.manage": true })).toEqual({ "users.view": true, "users.edit": true });
    expect(expandLegacyOverlay({ "users.manage": true, "users.edit": false })).toEqual({ "users.view": true, "users.edit": false });
    expect(expandLegacyOverlay(null)).toBeNull();
    expect(expandLegacyOverlay({ nonsense: true })).toEqual({});
  });
});

describe("hasPermission", () => {
  it("true for a plain admin, false for a restricted one", () => {
    expect(hasPermission({ role: "ADMIN", permissions: null }, "inventory.approve")).toBe(true);
    expect(hasPermission({ role: "ADMIN", permissions: { "inventory.approve": false } }, "inventory.approve")).toBe(false);
  });
});

describe("isRestrictedSubAdmin", () => {
  it("false for a plain ADMIN with no overlay", () => {
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: null })).toBe(false);
  });

  it("false for a non-ADMIN role even with a permissions blob set", () => {
    expect(isRestrictedSubAdmin({ role: "PLAN_MAKER", permissions: { "plans.edit": false } })).toBe(false);
  });

  it("true only once an ADMIN's overlay actually turns something off", () => {
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: {} })).toBe(false);
    expect(isRestrictedSubAdmin({ role: "ADMIN", permissions: { "users.edit": false } })).toBe(true);
  });
});

describe("computeNewAccountOverlay — new-account grant can never exceed the actor's own (privilege-escalation guard)", () => {
  const fullAdmin = { role: "ADMIN", permissions: null };
  const restrictedAdmin = { role: "ADMIN", permissions: { "campaigns.edit": false } };

  describe("new ADMIN accounts (baseline: everything)", () => {
    it("an unrestricted actor's overlay passes through unchanged, minimally stored", () => {
      expect(computeNewAccountOverlay(fullAdmin, {}, "ADMIN")).toEqual({});
      expect(computeNewAccountOverlay(fullAdmin, { "plans.approve": false }, "ADMIN")).toEqual({ "plans.approve": false });
    });

    it("forces a key the actor lacks to false even when the request doesn't mention it, or asks for true", () => {
      expect(computeNewAccountOverlay(restrictedAdmin, {}, "ADMIN")).toEqual({ "campaigns.edit": false });
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.edit": true }, "ADMIN")).toEqual({ "campaigns.edit": false });
    });

    it("turning a whole section off stores every one of its actions off", () => {
      const overlay = computeNewAccountOverlay(fullAdmin, { "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false }, "ADMIN");
      expect(overlay).toEqual({ "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false });
    });
  });

  describe("new non-ADMIN accounts (baseline: the role's own defaults)", () => {
    it("an unmentioned key stays at the role baseline — nothing extra from omitting `permissions`", () => {
      expect(computeNewAccountOverlay(fullAdmin, {}, "PLAN_MAKER")).toEqual({});
      expect(computeNewAccountOverlay(fullAdmin, {}, "FINANCE")).toEqual({});
    });

    it("an unrestricted actor's requested grant passes through, stored as a minimal overlay with view implied", () => {
      expect(computeNewAccountOverlay(fullAdmin, { "inventory.edit": true }, "PLAN_MAKER")).toEqual({ "inventory.edit": true });
      expect(computeNewAccountOverlay(fullAdmin, { "links.approve": true }, "PLAN_MAKER")).toEqual({ "links.view": true, "links.approve": true });
    });

    it("can take a baseline key away from a FINANCE account (e.g. no approve sign-off)", () => {
      expect(computeNewAccountOverlay(fullAdmin, { "finance.approve": false }, "FINANCE")).toEqual({ "finance.approve": false });
    });

    it("a restricted actor can't grant a key they don't hold, but can grant one they do", () => {
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.edit": true }, "PLAN_MAKER")).toEqual({});
      expect(computeNewAccountOverlay(restrictedAdmin, { "campaigns.edit": true, "finance.pay": true }, "PLAN_MAKER")).toEqual({ "finance.view": true, "finance.pay": true });
    });
  });
});

describe("clampPatchToActor — an edit can never grant a key the editor doesn't hold", () => {
  const fullAdmin = { role: "ADMIN", permissions: null };
  const restrictedAdmin = { role: "ADMIN", permissions: { "finance.pay": false } };

  it("an unrestricted actor's patch passes through unchanged", () => {
    expect(clampPatchToActor(fullAdmin, { "campaigns.edit": true, "plans.approve": false })).toEqual({ "campaigns.edit": true, "plans.approve": false });
  });

  it("forces a patched `true` down to false when the actor lacks that key; a `false` always passes", () => {
    expect(clampPatchToActor(restrictedAdmin, { "finance.pay": true })).toEqual({ "finance.pay": false });
    expect(clampPatchToActor(restrictedAdmin, { "campaigns.edit": false })).toEqual({ "campaigns.edit": false });
  });

  it("doesn't touch keys absent from the patch", () => {
    const result = clampPatchToActor(restrictedAdmin, { "plans.edit": true });
    expect(result).toEqual({ "plans.edit": true });
    expect(result).not.toHaveProperty("finance.pay");
  });
});

describe("sanitizePermissionsInput", () => {
  it("drops unknown keys and non-boolean values", () => {
    expect(sanitizePermissionsInput({ "campaigns.edit": false, notAKey: true, "plans.edit": "yes" })).toEqual({ "campaigns.edit": false });
  });

  it("accepts legacy keys and expands them", () => {
    expect(sanitizePermissionsInput({ "users.manage": false })).toEqual({ "users.view": false, "users.edit": false });
  });

  it("implies view from an action grant, and clears a section's actions when its view is turned off", () => {
    expect(sanitizePermissionsInput({ "links.approve": true })).toEqual({ "links.approve": true, "links.view": true });
    expect(sanitizePermissionsInput({ "finance.view": false })).toEqual({ "finance.view": false, "finance.edit": false, "finance.approve": false, "finance.pay": false });
  });

  it("returns null for non-object input", () => {
    expect(sanitizePermissionsInput(null)).toBeNull();
    expect(sanitizePermissionsInput(undefined)).toBeNull();
  });
});

describe("isFullAdmin — the only actor allowed to touch ADMIN accounts (23 Sep escalation guard)", () => {
  it("true for a plain ADMIN, false for a restricted sub-admin or any other role however granted", () => {
    expect(isFullAdmin({ role: "ADMIN", permissions: null })).toBe(true);
    expect(isFullAdmin({ role: "ADMIN", permissions: {} })).toBe(true);
    expect(isFullAdmin({ role: "ADMIN", permissions: { "finance.pay": false } })).toBe(false);
    expect(isFullAdmin({ role: "ADMIN", permissions: { "finance.manage": false } })).toBe(false); // legacy row
    expect(isFullAdmin({ role: "PLAN_MAKER", permissions: { "users.edit": true } })).toBe(false);
    expect(isFullAdmin(null)).toBe(false);
  });
});

describe("assertGrantableRole — CREATOR/TEAM_MEMBER can't carry an overlay (23 Sep)", () => {
  it("passes every other role, and passes those two roles when nothing is actually granted", () => {
    for (const role of ["ADMIN", "FINANCE", "PLAN_MAKER"]) {
      expect(isGrantableRole(role)).toBe(true);
      expect(() => assertGrantableRole(role, { "links.approve": true })).not.toThrow();
    }
    expect(() => assertGrantableRole("CREATOR", {})).not.toThrow();
    expect(() => assertGrantableRole("CREATOR", null)).not.toThrow();
    expect(() => assertGrantableRole("TEAM_MEMBER", { "links.approve": false })).not.toThrow();
  });

  it("throws a 400 ROLE_NOT_GRANTABLE for either role once any key is actually granted", () => {
    for (const role of ["CREATOR", "TEAM_MEMBER"]) {
      expect(isGrantableRole(role)).toBe(false);
      const err = (() => {
        try {
          assertGrantableRole(role, { "links.approve": true, "plans.edit": false });
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("ROLE_NOT_GRANTABLE");
    }
  });
});
