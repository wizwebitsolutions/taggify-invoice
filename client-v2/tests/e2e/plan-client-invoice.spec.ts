import { expect, test, type Page } from "@playwright/test";

import { API_URL, mockApi, shot, signIn, userFor } from "./fixtures";

/** Plan → client invoice dialog (v1 ClientInvoiceModal parity): saved-client fill, validation, numbering, tax note, PDF download. API mocked. */

const PRIYA = { id: "u-priya", name: "Priya Sharma" };

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Diwali Food Stories",
    clientName: "Saffron Street",
    clientContact: null,
    clientCompany: null as string | null,
    clientGstNumber: null as string | null,
    clientAddress: null as string | null,
    clientPhone: null as string | null,
    clientInvoiceNumber: null as string | null,
    clientInvoiceAt: null,
    invoiceDescription: null as string | null,
    hsnSac: null as string | null,
    notes: "Festive food reels",
    budget: "120000",
    isGstPlan: true,
    gstPercent: 18,
    status: "APPROVED",
    approvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [{ id: "i1", planId: "p1", assetId: "a1", format: "reel", cost: "28000", clientCost: null, postsPerProfile: 2, asset: { id: "a1", handle: "desi.memes", category: "Meme page", followers: 1200000, platform: "instagram" } }],
    totalCost: 56000,
    budgetVariance: 64000,
    expectedEngagement: { likes: 0, views: 0 },
    overview: { totalFollowers: 1200000, totalPosts: 2, expectedImpressions: 0, subtotal: 82000, gstAmount: 14760, total: 96760 },
    internal: { computedFollowers: 1200000, computedPosts: 2, computedImpressions: 0, computedSubtotal: 56000, computedGstAmount: 10080, computedTotal: 66080 },
    overrideFollowers: null,
    overridePosts: null,
    overrideImpressions: null,
    overrideCost: 82000,
    pitchGroupId: null,
    variantLabel: "Plan A",
    clientSheetUrl: null,
    internalSheetUrl: null,
    executionSheetUrl: null,
    campaignId: "camp-1",
    createdBy: PRIYA,
    ...overrides,
  };
}

const SAFFRON_MH = { clientName: "Saffron Street", clientCompany: "Saffron Street Foods", clientGstNumber: "27AAKCS1234L1Z5", clientAddress: "Lower Parel, Mumbai", clientPhone: "+919812345678" };
const SAFFRON_KA = { clientName: "Saffron Street", clientCompany: "Saffron Street Foods (Bengaluru)", clientGstNumber: "29AAKCS1234L1Z3", clientAddress: "Indiranagar, Bengaluru", clientPhone: null };

async function invoiceApi(page: Page, p: ReturnType<typeof plan>, clients: unknown[]) {
  const calls = { generated: [] as Record<string, unknown>[], pdf: 0 };
  await mockApi(page);
  await page.route(`${API_URL}/plans**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/plans/, "");
    if (req.method() === "GET" && path === "") return route.fulfill({ json: [p] });
    if (req.method() === "GET" && path === "/clients") return route.fulfill({ json: clients });
    if (req.method() === "GET" && path === "/client-invoice-numbering") return route.fulfill({ json: { prefix: "TGF/26-27/", nextNumber: 7, suggestion: "TGF/26-27/007", defaultHsnSac: "998361", companyStateCode: "27" } });
    if (req.method() === "POST" && path === "/p1/client-invoice") {
      const body = req.postDataJSON();
      calls.generated.push(body);
      Object.assign(p, body, { clientInvoiceNumber: body.clientInvoiceNumber ?? p.clientInvoiceNumber ?? "TGF/26-27/007" });
      return route.fulfill({ json: p });
    }
    if (req.method() === "GET" && path === "/p1/client-invoice.pdf") {
      calls.pdf++;
      return route.fulfill({ status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.4\n%%EOF" });
    }
    if (req.method() === "GET" && path === "/p1") return route.fulfill({ json: p });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_MOCKED", message: path } } });
  });
  return calls;
}

test.describe("Plan client invoice", () => {
  test.use({ viewport: { width: 1536, height: 1000 } });

  test("admin: fills from the one saved client, validates, generates with the suggested number and downloads the PDF", async ({ page }) => {
    await signIn(page, "ADMIN");
    const calls = await invoiceApi(page, plan(), [SAFFRON_MH]);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "Generate client invoice" }).click();
    const dialog = page.getByRole("dialog");

    // Numbering API: the next number and the default HSN/SAC.
    await expect(dialog.getByLabel("Invoice no.")).toHaveValue("TGF/26-27/007");
    await expect(dialog.getByLabel("HSN/SAC")).toHaveValue("998361");
    // The plan has no billing details yet and one saved profile matches its client: filled in.
    await expect(dialog.getByLabel("Company name")).toHaveValue("Saffron Street Foods");
    await expect(dialog.getByLabel("GST number")).toHaveValue("27AAKCS1234L1Z5");
    await expect(dialog.getByLabel("Billing address")).toHaveValue("Lower Parel, Mumbai");
    await expect(dialog.getByLabel("Phone (optional)")).toHaveValue("9812345678");
    await expect(dialog.getByText("Filled in from Saffron Street Foods's last invoice.", { exact: false })).toBeVisible();
    // Same state code as Taggify (27): CGST + SGST.
    await expect(dialog.getByText("Same state as Taggify, so the invoice charges CGST 9% + SGST 9%.")).toBeVisible();

    // Validation: nothing is sent while any field is wrong.
    await dialog.getByLabel("Invoice no.").fill("TGF 007");
    await dialog.getByLabel("GST number").fill("27ABC");
    await dialog.getByLabel("Phone (optional)").fill("98123");
    await dialog.getByRole("button", { name: "Generate invoice" }).click();
    await expect(dialog.getByText("Use letters, digits and / . _ - only.")).toBeVisible();
    await expect(dialog.getByText("GSTIN is 15 characters, e.g. 27ABCDE1234F1Z5.")).toBeVisible();
    await expect(dialog.getByText("Enter a 10-digit mobile number, or leave it empty.")).toBeVisible();
    await expect(dialog.getByText("Description of goods/service is required.")).toBeVisible();
    await shot(page, "plan-client-invoice-errors");
    expect(calls.generated).toHaveLength(0);

    await dialog.getByLabel("Invoice no.").fill("TGF/26-27/007");
    await dialog.getByLabel("GST number").fill("29aakcs1234l1z3");
    await expect(dialog.getByText("Different state from Taggify, so the invoice charges IGST 18%.")).toBeVisible();
    await dialog.getByLabel("GST number").fill("27AAKCS1234L1Z5");
    await dialog.getByLabel("Phone (optional)").fill("9812345678");
    await dialog.getByLabel("Description of goods/service").fill("Influencer marketing services");
    await dialog.getByRole("button", { name: "Generate invoice" }).click();

    await expect(dialog.getByTestId("client-invoice-generated")).toContainText("Invoice TGF/26-27/007");
    expect(calls.generated).toEqual([
      {
        clientCompany: "Saffron Street Foods",
        clientGstNumber: "27AAKCS1234L1Z5",
        clientAddress: "Lower Parel, Mumbai",
        clientPhone: "+919812345678",
        invoiceDescription: "Influencer marketing services",
        hsnSac: "998361",
        clientInvoiceNumber: "TGF/26-27/007",
      },
    ]);
    // The PDF downloads straight away, and again on request.
    await expect.poll(() => calls.pdf).toBe(1);
    await shot(page, "plan-client-invoice-generated");
    await dialog.getByRole("button", { name: "Download again" }).click();
    await expect.poll(() => calls.pdf).toBe(2);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("several saved profiles under the client's name: nothing is guessed, picking one fills the details", async ({ page }) => {
    await signIn(page, "ADMIN");
    await invoiceApi(page, plan(), [SAFFRON_MH, SAFFRON_KA]);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "Generate client invoice" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Saffron Street has 2 saved billing profiles. Pick one here.")).toBeVisible();
    await expect(dialog.getByLabel("Company name")).toHaveValue("");
    await dialog.getByRole("combobox", { name: "Saved client" }).click();
    await page.getByRole("option", { name: /Bengaluru/ }).click();
    await expect(dialog.getByLabel("Company name")).toHaveValue("Saffron Street Foods (Bengaluru)");
    await expect(dialog.getByLabel("GST number")).toHaveValue("29AAKCS1234L1Z3");
    await expect(dialog.getByLabel("Billing address")).toHaveValue("Indiranagar, Bengaluru");
    await expect(dialog.getByText("Different state from Taggify, so the invoice charges IGST 18%.")).toBeVisible();
  });

  test("regenerating: admin can change the number; a planner sees it read-only and doesn't send one", async ({ page }) => {
    const issued = { clientCompany: "Saffron Street Foods", clientGstNumber: "27AAKCS1234L1Z5", clientAddress: "Mumbai", invoiceDescription: "Influencer marketing services", hsnSac: "998361", clientInvoiceNumber: "TGF/26-27/003" };
    await signIn(page, "ADMIN");
    const calls = await invoiceApi(page, plan(issued), [SAFFRON_MH]);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog");
    // The plan's own details and number, not the saved profile or the counter.
    await expect(dialog.getByLabel("Invoice no.")).toHaveValue("TGF/26-27/003");
    await expect(dialog.getByLabel("Billing address")).toHaveValue("Mumbai");
    await expect(dialog.getByText("Reissues TGF/26-27/003 with these details.")).toBeVisible();
    await dialog.getByLabel("Invoice no.").fill("TGF/26-27/009");
    await dialog.getByRole("button", { name: "Regenerate invoice" }).click();
    await expect(dialog.getByTestId("client-invoice-generated")).toContainText("Invoice TGF/26-27/009");
    expect(calls.generated[0]).toMatchObject({ clientInvoiceNumber: "TGF/26-27/009", clientPhone: "" });
    await expect.poll(() => calls.pdf).toBe(1);
  });

  test("a planner can't set the number: it's read-only and left to the server", async ({ page }) => {
    const planner = userFor("PLAN_MAKER");
    await signIn(page, "PLAN_MAKER");
    const calls = await invoiceApi(page, plan({ createdBy: { id: planner.id, name: planner.name }, clientCompany: "Saffron Street Foods", clientGstNumber: "27AAKCS1234L1Z5", clientAddress: "Mumbai", invoiceDescription: "Reels" }), []);
    await page.goto("/plans/p1");
    await page.getByRole("button", { name: "Generate client invoice" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Invoice no.")).toHaveAttribute("readonly", "");
    await expect(dialog.getByText("Set by Admin or Finance.")).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Saved client" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Generate invoice" }).click();
    await expect(dialog.getByTestId("client-invoice-generated")).toBeVisible();
    expect(calls.generated[0]).not.toHaveProperty("clientInvoiceNumber");
  });
});
