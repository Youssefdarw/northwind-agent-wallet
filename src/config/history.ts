/**
 * Reference data for the smart checks: Northwind Industrial's purchase orders and
 * the bills it paid in earlier months. Seeded for the demo (in a real product
 * these would come from the accounting system).
 */
import type { PaidRecord, PurchaseOrder } from "../policy/types.js";

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  { number: "PO-TEST-01", merchantId: "parts_supplier", amountUsd: 3975, description: "Air-end overhaul kits ×3", issuedAt: "2026-08-20" },
  { number: "PO-TEST-02", merchantId: "parts_supplier", amountUsd: 4850, description: "Air-end bearings, valves, filters", issuedAt: "2026-10-14" },
  { number: "PO-TEST-03", merchantId: "parts_supplier", amountUsd: 1200, description: "Oil separator elements ×8", issuedAt: "2026-11-02" },
];

/** Bills paid in September and October 2026 (before this demo's first run). */
export const PAST_PAYMENTS: Omit<PaidRecord, "thisMonth">[] = [
  { merchantId: "office_suite", invoiceNumber: "TEST-OFF-2609", billType: "subscription", totalUsd: 36, at: "2026-09-03" },
  { merchantId: "hosting", invoiceNumber: "TEST-HOST-2609", billType: "subscription", totalUsd: 12, at: "2026-09-05" },
  { merchantId: "parts_supplier", invoiceNumber: "TEST-PRT-0001", billType: "invoice", totalUsd: 3975, poNumber: "PO-TEST-01", at: "2026-09-18" },
  { merchantId: "office_suite", invoiceNumber: "TEST-OFF-2610", billType: "subscription", totalUsd: 36, at: "2026-10-03" },
  { merchantId: "hosting", invoiceNumber: "TEST-HOST-2610", billType: "subscription", totalUsd: 12, at: "2026-10-05" },
  { merchantId: "freight_forwarder", invoiceNumber: "TEST-FRT-0001", billType: "invoice", totalUsd: 290, at: "2026-10-21" },
];
