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
  OWN_CAPABILITIES,
  getOwnCapabilities,
  hasOwnCapability,
  ownOverlayFor,
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

  it("own-scope roles (CREATOR, TEAM_MEMBER, PLAN_MAKER) hold no global key — even with a stored overlay that says otherwise (24 Sep)", () => {
    for (const role of ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"]) {
      for (const permissions of [null, { "links.approve": true, "finance.pay": true, "users.manage": true }]) {
        const effective = getEffectivePermissions({ role, permissions });
        for (const key of PERMISSION_KEYS) expect(effective[key], `${role} ${key}`).toBe(false);
      }
    }
  });

  it("lets an overlay grant a staff (FINANCE) account an individual key without touching the rest", () => {
    const effective = getEffectivePermissions({ role: "FINANCE", permissions: { "campaigns.edit": true } });
    expect(effective["campaigns.edit"]).toBe(true);
    expect(effective["campaigns.view"]).toBe(true); // implied
    expect(effective["users.view"]).toBe(false);
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

    const granted = getEffectivePermissions({ role: "FINANCE", permissions: { "links.review": true } });
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
      expect(computeNewAccountOverlay(fullAdmin, { "inventory.edit": true }, "FINANCE")).toEqual({ "inventory.edit": true });
      expect(computeNewAccountOverlay(fullAdmin, { "users.edit": true }, "FINANCE")).toEqual({ "users.view": true, "users.edit": true });
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

describe("own-scope roles: own-content switches instead of global grants (24 Sep)", () => {
  it("staff roles are grantable; CREATOR, TEAM_MEMBER and PLAN_MAKER are not (they get own-content switches)", () => {
    for (const role of ["ADMIN", "FINANCE"]) expect(isGrantableRole(role)).toBe(true);
    for (const role of ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"]) expect(isGrantableRole(role)).toBe(false);
  });

  it("every own capability defaults ON; keys outside the role's list are always off", () => {
    for (const role of ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"]) {
      const caps = getOwnCapabilities({ role, permissions: null });
      for (const key of PERMISSION_KEYS) expect(caps[key], `${role} ${key}`).toBe(OWN_CAPABILITIES[role].includes(key));
    }
    // A creator can never hold an approve/pay switch, even if one is stored.
    const creator = getOwnCapabilities({ role: "CREATOR", permissions: { "links.approve": true, "finance.pay": true } });
    expect(creator["links.approve"]).toBe(false);
    expect(creator["finance.pay"]).toBe(false);
    // Staff accounts have no own-content switches.
    for (const key of PERMISSION_KEYS) expect(getOwnCapabilities({ role: "ADMIN", permissions: null })[key]).toBe(false);
  });

  it("the admin can switch one off; turning a section's view off takes its actions with it", () => {
    const noInvoicing = getOwnCapabilities({ role: "CREATOR", permissions: { "finance.edit": false } });
    expect(noInvoicing["finance.edit"]).toBe(false);
    expect(noInvoicing["finance.view"]).toBe(true);
    const noFinance = getOwnCapabilities({ role: "CREATOR", permissions: { "finance.view": false } });
    expect(noFinance["finance.edit"]).toBe(false);
    expect(hasOwnCapability({ role: "PLAN_MAKER", permissions: { "plans.edit": false } }, "plans.edit")).toBe(false);
    expect(hasOwnCapability({ role: "PLAN_MAKER", permissions: { "plans.edit": false } }, "plans.view")).toBe(true);
  });

  it("an overlay left by the old global-grant model doesn't switch a planner's own sections off", () => {
    // Real row shape from before 23 Sep: false there meant "no global grant", not "switched off".
    const legacy = { "links.review": false, "plans.manage": true, "users.manage": false, "finance.manage": false, "campaigns.manage": false, "inventory.manage": false };
    const caps = getOwnCapabilities({ role: "PLAN_MAKER", permissions: legacy });
    for (const key of OWN_CAPABILITIES.PLAN_MAKER) expect(caps[key], key).toBe(true);
    // Same for a 23 Sep per-action map carrying a global grant alongside.
    const perAction = getOwnCapabilities({ role: "PLAN_MAKER", permissions: { "finance.view": true, "campaigns.view": false } });
    expect(perAction["campaigns.view"]).toBe(true);
    // Saving the editor over a legacy row doesn't carry the old values forward.
    expect(ownOverlayFor("PLAN_MAKER", { "plans.edit": false }, legacy)).toEqual({ "plans.edit": false });
    // A genuine own overlay is still honoured.
    expect(getOwnCapabilities({ role: "PLAN_MAKER", permissions: { "campaigns.view": false } })["campaigns.view"]).toBe(false);
  });

  it("ownOverlayFor stores only what's switched off, and merges with the existing overlay", () => {
    expect(ownOverlayFor("CREATOR", {})).toBeNull();
    expect(ownOverlayFor("CREATOR", { "finance.edit": false, "links.view": true })).toEqual({ "finance.edit": false });
    expect(ownOverlayFor("CREATOR", { "links.edit": false }, { "finance.edit": false })).toEqual({ "finance.edit": false, "links.edit": false });
    expect(ownOverlayFor("CREATOR", { "finance.edit": true }, { "finance.edit": false })).toBeNull();
    // Switching off a key outside the role's list is a harmless no-op.
    expect(ownOverlayFor("TEAM_MEMBER", { "links.approve": false })).toBeNull();
  });

  it("ownOverlayFor refuses to *give* an own-scope role anything outside its own content (400 OWN_SCOPE_ONLY)", () => {
    for (const [role, key] of [["CREATOR", "links.approve"], ["TEAM_MEMBER", "finance.edit"], ["PLAN_MAKER", "finance.pay"], ["PLAN_MAKER", "users.edit"]]) {
      const err = (() => {
        try {
          ownOverlayFor(role, { [key]: true });
        } catch (e) {
          return e;
        }
      })();
      expect(err, `${role} ${key}`).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("OWN_SCOPE_ONLY");
    }
  });

  it("PLAN_MAKER can be granted inventory.edit (25 Sep — vendor onboarding while building a plan), on by default", () => {
    expect(OWN_CAPABILITIES.PLAN_MAKER).toContain("inventory.edit");
    // Granting it no longer throws OWN_SCOPE_ONLY (regression check for the old, narrower whitelist).
    expect(ownOverlayFor("PLAN_MAKER", { "inventory.edit": true })).toBeNull();
    expect(hasOwnCapability({ role: "PLAN_MAKER", permissions: null }, "inventory.edit")).toBe(true);
    expect(hasOwnCapability({ role: "PLAN_MAKER", permissions: { "inventory.edit": false } }, "inventory.edit")).toBe(false);
  });

  it("finance.pay is never own-scope, for any role", () => {
    for (const role of ["CREATOR", "TEAM_MEMBER", "PLAN_MAKER"]) {
      expect(OWN_CAPABILITIES[role], role).not.toContain("finance.pay");
    }
  });
});
