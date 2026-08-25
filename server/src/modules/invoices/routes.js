import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import {
  bulkInvoiceSchema,
  gstStatusSchema,
  paymentStatusSchema,
  rejectInvoiceSchema,
  listInvoicesQuerySchema,
} from "./schemas.js";
import * as invoicesService from "./service.js";
import { buildInvoicePdf } from "../../lib/invoicePdf.js";

const router = Router();
router.use(requireAuth);

router.get("/", validateQuery(listInvoicesQuerySchema), async (req, res, next) => {
  try {
    res.json(await invoicesService.listInvoices(req.user, req.query));
  } catch (err) {
    next(err);
  }
});

router.post("/bulk", requireRole("CREATOR", "ADMIN"), validateBody(bulkInvoiceSchema), async (req, res, next) => {
  try {
    res.status(201).json(await invoicesService.bulkCreateInvoice(req.user, req.body));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/mark-paid", requireRole("FINANCE", "ADMIN"), async (req, res, next) => {
  try {
    res.json(await invoicesService.markPaid(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/gst-status", requireRole("FINANCE", "ADMIN"), validateBody(gstStatusSchema), async (req, res, next) => {
  try {
    res.json(await invoicesService.updateGstStatus(req.params.id, req.body.gstStatus));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/payment-status", requireRole("FINANCE", "ADMIN"), validateBody(paymentStatusSchema), async (req, res, next) => {
  try {
    res.json(await invoicesService.updatePaymentStatus(req.params.id, req.body.paymentStatus));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/reject", requireRole("FINANCE", "ADMIN"), validateBody(rejectInvoiceSchema), async (req, res, next) => {
  try {
    res.json(await invoicesService.rejectInvoice(req.params.id, req.user, req.body));
  } catch (err) {
    next(err);
  }
});

// Plain-text list of post URLs — creator.wldd.in's "Download Links" action.
router.get("/:id/links.txt", async (req, res, next) => {
  try {
    const urls = await invoicesService.getInvoiceLinksList(req.params.id, req.user);
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${req.params.id}-links.txt"`);
    res.send(urls.join("\n"));
  } catch (err) {
    next(err);
  }
});

// Downloadable PDF — same visibility rule as GET /invoices (own invoices,
// or any invoice for ADMIN/FINANCE), enforced in getInvoiceDetail.
router.get("/:id/pdf", async (req, res, next) => {
  try {
    const invoice = await invoicesService.getInvoiceDetail(req.params.id, req.user);
    const pdf = await buildInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
