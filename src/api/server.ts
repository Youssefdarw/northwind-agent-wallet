/**
 * Dashboard API (localhost only). Every money-moving action goes through the same
 * policy-gated service the agent uses; this server adds no new path to funds.
 *
 *   GET  /api/state                 everything the dashboard shows (polled)
 *   POST /api/run {compromised}     start the agent ("Run this month's bills")
 *   POST /api/bills/:id/approve     owner approves a held payment (policy re-checked)
 *   POST /api/bills/:id/reject      owner rejects a held payment
 *   PUT  /api/policy                save an edited policy (validated, version bumped)
 *   GET  /api/mandates/:id          a mandate + live signature verification
 *   POST /api/invoices/read         upload a PDF/photo → Claude extracts it → draft for review
 *   POST /api/invoices/:draft/add   owner confirms the supplier → the invoice becomes a bill
 *   POST /api/merchants             owner adds a merchant (system generates its wallet)
 *   DELETE /api/merchants/:id       owner removes a merchant they added
 *   POST /api/ask {question,history} read-only Q&A about the bills (no tools, can't act)
 *   POST /api/reset                 clear ledger, mandates, policy (wallets untouched)
 *
 * READ_ONLY=1 turns every change off (for showing someone the dashboard);
 * READ_ONLY_ALLOW_ASK=1 keeps "Ask the agent" on in that mode, rate-limited.
 */
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getPublicClient } from "../config/network.js";
import { getAddressFor } from "../config/wallets.js";
import { randomUUID } from "node:crypto";
import { getMerchants, getVendors, merchantAddress, merchantUrl } from "../config/scenario.js";
import { addCustomMerchant, addUploadedBill, removeCustomMerchant, suggestVendor, type NewMerchantInput, type UploadChoice } from "../merchants/custom.js";
import { ACCEPTED_TYPES, ExtractionError, MAX_UPLOAD_BYTES, computedNotes, extractInvoice, type AcceptedType, type InvoiceExtraction } from "../invoices/extract.js";
import { loadPolicy, savePolicy, resetPolicy } from "../policy/store.js";
import { getUsdcBalance } from "../wallets/balance.js";
import { approveHeld, localDate, rejectHeld, ledger, mandates } from "../billing/service.js";
import { runAgent, AGENT_MODEL } from "../agent/run.js";
import { AskError, askAgent, askContext, type AskTurn } from "../agent/ask.js";
import { DATA_DIR, readJson, writeJson } from "../store/json.js";
import { buildState, mandateView } from "./state.js";
import type { DashboardState, LiveLogLine, MandateView } from "./types.js";

const PORT = Number(process.env.API_PORT || 4000);
const READ_ONLY = process.env.READ_ONLY === "1";
const READ_ONLY_ALLOW_ASK = READ_ONLY && process.env.READ_ONLY_ALLOW_ASK === "1";
const app = express();
app.use(express.json({ limit: "12mb" })); // invoice uploads arrive as base64

// Read-only mode: only GETs (and Ask, if allowed) get through. Checked before any route.
app.use((req, res, next) => {
  if (!READ_ONLY || req.method === "GET" || (READ_ONLY_ALLOW_ASK && req.path === "/api/ask")) return next();
  res.status(403).json({ error: "This dashboard is read-only" });
});

// ── Live log (kept in data/live-log.json so the snapshot can show the last run) ──
const LIVE_LOG_PATH = resolve(DATA_DIR, "live-log.json");
const liveLog: LiveLogLine[] = readJson<LiveLogLine[]>(LIVE_LOG_PATH, []);
let saveTimer: NodeJS.Timeout | null = null;
const saveLiveLog = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJson(LIVE_LOG_PATH, liveLog);
  }, 500);
};
const pushLog = (kind: LiveLogLine["kind"], text: string) => {
  liveLog.push({ at: new Date().toISOString(), kind, text });
  if (liveLog.length > 400) liveLog.splice(0, liveLog.length - 400);
  saveLiveLog();
};
let busy: string | null = null; // what's running right now (agent run / approval)

let balanceCache: { at: number; usdc: string | null } = { at: 0, usdc: null };
async function treasuryBalance(): Promise<string | null> {
  if (Date.now() - balanceCache.at < 4000) return balanceCache.usdc;
  try {
    balanceCache = { at: Date.now(), usdc: (await getUsdcBalance(getAddressFor("treasury"))).usdc };
  } catch {
    balanceCache = { at: Date.now(), usdc: balanceCache.usdc };
  }
  return balanceCache.usdc;
}

let merchantsCache = { at: 0, online: false };
async function merchantsOnline(): Promise<boolean> {
  if (Date.now() - merchantsCache.at < 5000) return merchantsCache.online;
  const results = await Promise.all(
    getMerchants().map((m) => fetch(merchantUrl(m, "/invoice"), { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)),
  );
  merchantsCache = { at: Date.now(), online: results.every(Boolean) };
  return merchantsCache.online;
}

const send = (res: Response, fn: () => Promise<unknown> | unknown) =>
  Promise.resolve()
    .then(fn)
    .then((body) => res.json(body))
    .catch((err: unknown) => res.status(400).json({ error: err instanceof Error ? err.message : String(err) }));

// ── Routes ──────────────────────────────────────────────────────────────
app.get("/api/state", (_req, res) =>
  send(res, async (): Promise<DashboardState> =>
    buildState({
      treasuryUsdc: await treasuryBalance(),
      merchantsOnline: await merchantsOnline(),
      liveLog,
      busy,
      readOnly: READ_ONLY ? { mode: "server", askEnabled: READ_ONLY_ALLOW_ASK, takenAt: new Date().toISOString() } : null,
    }),
  ),
);

// ── Ask the agent (read-only Q&A) ──────────────────────────────────────
let asking = 0;
const askTimes: number[] = [];
const ASK_LIMIT_PER_HOUR = READ_ONLY ? 30 : 200;
app.post("/api/ask", (req, res) =>
  send(res, async () => {
    if (asking >= 2) throw new Error("Already answering; one moment");
    const now = Date.now();
    while (askTimes.length && now - askTimes[0]! > 3_600_000) askTimes.shift();
    if (askTimes.length >= ASK_LIMIT_PER_HOUR) throw new Error("Question limit reached for this hour");
    const { question, history } = (req.body ?? {}) as { question?: unknown; history?: unknown };
    const turns: AskTurn[] = Array.isArray(history)
      ? history.filter((t): t is AskTurn => !!t && typeof t === "object" && typeof (t as AskTurn).text === "string")
      : [];
    const state = buildState({ treasuryUsdc: await treasuryBalance(), merchantsOnline: true, liveLog: [], busy, readOnly: null });
    askTimes.push(now);
    asking++;
    try {
      return { answer: await askAgent(String(question ?? ""), turns, askContext(state, localDate())) };
    } catch (err) {
      if (err instanceof AskError) throw new Error(err.message);
      throw err;
    } finally {
      asking--;
    }
  }),
);

app.post("/api/run", (req: Request, res: Response) => {
  if (busy) return res.status(409).json({ error: `Busy: ${busy}` });
  const compromised = !!req.body?.compromised;
  const language = req.body?.language === "ar" ? "ar" : "en";
  busy = compromised ? "Agent run (red-team mode)" : "Agent run";
  liveLog.length = 0;
  pushLog("system", `▶ ${busy} started · ${AGENT_MODEL}`);
  balanceCache.at = 0;
  runAgent({
    compromised,
    language,
    log: (e) => {
      if (e.type === "text") pushLog("agent", e.text);
      else if (e.type === "tool_call") {
        const { reasoning, note, ...rest } = e.input as Record<string, string>;
        pushLog("tool", `${e.name}(${Object.values(rest).join(", ")})${reasoning ? ` · "${reasoning}"` : ""}${note ? ` · note: "${note}"` : ""}`);
      } else if (e.type === "progress") pushLog("progress", e.message.trim());
      else if (e.type === "error") pushLog("error", e.message);
      else if (e.type === "done") pushLog("system", `■ Run finished · ${(e.usage.input + e.usage.cacheRead).toLocaleString()} input tokens, ${e.usage.output.toLocaleString()} output`);
    },
  })
    .catch((err) => pushLog("error", String(err)))
    .finally(() => {
      busy = null;
      balanceCache.at = 0;
    });
  res.status(202).json({ started: true });
});

app.post("/api/bills/:id/approve", (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (busy) return res.status(409).json({ error: `Busy: ${busy}` });
  if (ledger.bill(id as never)?.status !== "awaiting_approval") return res.status(400).json({ error: "Not awaiting approval" });
  busy = `Paying approved bill (${id})`;
  pushLog("system", `✔ Owner approved ${id}. Re-checking policy with human approval…`);
  approveHeld(id, { onProgress: (m) => pushLog("progress", m.trim()) })
    .then((r) => pushLog("system", `Approval result for ${id}: ${r.outcome}`))
    .catch((err) => pushLog("error", `Approve ${id} failed: ${err instanceof Error ? err.message : err}`))
    .finally(() => {
      busy = null;
      balanceCache.at = 0;
    });
  res.status(202).json({ started: true });
});

app.post("/api/bills/:id/reject", (req, res) =>
  send(res, () => {
    const r = rejectHeld(String(req.params.id));
    pushLog("system", `✖ Owner rejected ${req.params.id}. Nothing was signed.`);
    return r;
  }),
);

app.put("/api/policy", (req, res) =>
  send(res, () => {
    if (busy) throw new Error("Can't change policy while a run is in progress");
    const b = req.body ?? {};
    const current = loadPolicy();
    const allowIds: string[] = Array.isArray(b.allowlistIds) ? b.allowlistIds : current.allowlist.map((e) => e.merchantId);
    const p = savePolicy({
      monthlyBudgetUsd: Number(b.monthlyBudgetUsd ?? current.monthlyBudgetUsd),
      autoApproveLimitUsd: Number(b.autoApproveLimitUsd ?? current.autoApproveLimitUsd),
      maxPricePerCallUsd: Number(b.maxPricePerCallUsd ?? current.maxPricePerCallUsd),
      network: current.network, // not editable: testnet only
      // Allowlist entries are bound to each merchant's known wallet; the UI can only toggle them.
      allowlist: getVendors()
        .filter((m) => allowIds.includes(m.id))
        .map((m) => ({ merchantId: m.id, name: m.name, payTo: merchantAddress(m) })),
    });
    pushLog("system", `Policy saved as v${p.version}`);
    return p;
  }),
);

app.post("/api/merchants", (req, res) =>
  send(res, () => {
    if (busy) throw new Error("Can't add a merchant while a run is in progress");
    const b = (req.body ?? {}) as Partial<NewMerchantInput>;
    const m = addCustomMerchant({
      name: String(b.name ?? ""),
      domain: String(b.domain ?? ""),
      billType: b.billType === "subscription" ? "subscription" : b.billType === "invoice" ? "invoice" : (String(b.billType) as never),
      amountUsd: Number(b.amountUsd),
      description: b.description ? String(b.description) : undefined,
      invoiceNumber: b.invoiceNumber ? String(b.invoiceNumber) : undefined,
      allowlist: !!b.allowlist,
    });
    pushLog("system", `+ Owner added merchant ${m.name} (${m.domain}). New wallet ${m.payTo} generated; key stored in .env.`);
    ledger.event("system", `Owner added merchant ${m.name} (${m.domain}), invoice ${m.invoiceNumber}, wallet ${m.payTo}`, m.id);
    const current = loadPolicy(); // a fresh default policy may already include it
    if (b.allowlist && !current.allowlist.some((e) => e.merchantId === m.id)) {
      const p = savePolicy({ ...current, allowlist: [...current.allowlist, { merchantId: m.id, name: m.name, payTo: m.payTo! }] });
      pushLog("system", `Policy saved as v${p.version}: ${m.name} added to the allowlist`);
    }
    merchantsCache.at = 0;
    return m;
  }),
);

app.delete("/api/merchants/:id", (req, res) =>
  send(res, () => {
    if (busy) throw new Error("Can't remove a merchant while a run is in progress");
    const id = String(req.params.id);
    const st = ledger.bill(id)?.status;
    if (st === "paying" || st === "awaiting_approval") throw new Error("Finish or reject this bill before removing the merchant");
    const { removed: m, alsoRemoved } = removeCustomMerchant(id);
    for (const x of alsoRemoved) pushLog("system", `− Also removed uploaded invoice ${x.invoiceNumber} from ${m.name}`);
    const current = loadPolicy();
    if (current.allowlist.some((e) => e.merchantId === id)) {
      const p = savePolicy({ ...current, allowlist: current.allowlist.filter((e) => e.merchantId !== id) });
      pushLog("system", `Policy saved as v${p.version}: ${m.name} removed from the allowlist`);
    }
    pushLog("system", `− Owner removed merchant ${m.name}`);
    ledger.event("system", `Owner removed merchant ${m.name}`, id);
    merchantsCache.at = 0;
    return { ok: true };
  }),
);

// ── Invoice upload: read → review → add ──────────────────────────────────
interface Draft {
  id: string;
  createdAt: number;
  fileName: string;
  extraction: InvoiceExtraction;
  computed: string[];
  suggestion: { vendorId: string | null; why: string };
}
const drafts = new Map<string, Draft>();
const DRAFT_TTL_MS = 60 * 60 * 1000;

app.post("/api/invoices/read", (req, res) =>
  send(res, async () => {
    if (busy) throw new Error("Wait for the current run to finish");
    const { fileName, mediaType, dataBase64 } = (req.body ?? {}) as { fileName?: string; mediaType?: string; dataBase64?: string };
    if (!ACCEPTED_TYPES.includes(mediaType as AcceptedType)) throw new Error("Upload a PDF, PNG, JPG or WEBP");
    const data = Buffer.from(String(dataBase64 ?? ""), "base64");
    if (!data.length) throw new Error("Empty file");
    if (data.length > MAX_UPLOAD_BYTES) throw new Error("File is larger than 8 MB");
    const name = String(fileName ?? "invoice").slice(0, 120);
    pushLog("system", `📄 Reading ${name} with ${AGENT_MODEL}…`);
    let extraction: InvoiceExtraction;
    try {
      extraction = await extractInvoice({ data, mediaType: mediaType as AcceptedType, fileName: name });
    } catch (err) {
      if (err instanceof ExtractionError) throw new Error(err.message);
      throw err;
    }
    for (const [k, d] of drafts) if (Date.now() - d.createdAt > DRAFT_TTL_MS) drafts.delete(k);
    const draft: Draft = {
      id: randomUUID(),
      createdAt: Date.now(),
      fileName: name,
      extraction,
      computed: computedNotes(extraction),
      suggestion: suggestVendor(extraction.vendor_name, extraction.vendor_domain),
    };
    drafts.set(draft.id, draft);
    pushLog("system", `📄 ${name}: ${extraction.summary_en}${extraction.suspicious_instructions.length ? " ⚠ contains instructions aimed at an AI" : ""}`);
    const vendors = getVendors().map((v) => ({ id: v.id, name: v.name, domain: v.domain, payTo: merchantAddress(v) }));
    return { ...draft, vendors };
  }),
);

app.post("/api/invoices/:draft/add", (req, res) =>
  send(res, () => {
    if (busy) throw new Error("Wait for the current run to finish");
    const d = drafts.get(String(req.params.draft));
    if (!d) throw new Error("This upload expired. Please upload the file again.");
    const x = d.extraction;
    if (x.currency.toUpperCase() !== "USD") throw new Error(`This demo pays USD invoices only (this one is in ${x.currency})`);
    if (x.total_amount === null) throw new Error("No total amount was found on the invoice");
    const b = (req.body ?? {}) as { vendorId?: string; newVendor?: { name?: string; domain?: string; allowlist?: boolean } };
    const choice: UploadChoice = b.vendorId
      ? { kind: "existing", vendorId: String(b.vendorId) }
      : { kind: "new", name: String(b.newVendor?.name ?? ""), domain: String(b.newVendor?.domain ?? ""), allowlist: !!b.newVendor?.allowlist };
    const items = x.line_items.map((l) => l.description).join("; ");
    const m = addUploadedBill(
      {
        invoiceNumber: x.invoice_number,
        amountUsd: x.total_amount,
        recurring: x.is_recurring_subscription,
        poNumber: x.po_number,
        // What the agent reads: the line items plus any text the invoice addresses to an AI, verbatim.
        description: [items, ...x.suspicious_instructions].filter(Boolean).join(" ").slice(0, 300),
        statedWallet: x.payment_wallet_address,
        info: {
          fileName: d.fileName,
          uploadedAt: new Date().toISOString(),
          language: x.document_language,
          invoiceDate: x.invoice_date,
          dueDate: x.due_date,
          lineItems: x.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unit_price, amount: l.amount })),
          suspiciousInstructions: x.suspicious_instructions,
          reviewNotes: x.review_notes,
          computedNotes: d.computed,
          summaryEn: x.summary_en,
          summaryAr: x.summary_ar,
          statedWallet: x.payment_wallet_address,
          statedBankDetails: x.other_payment_details,
        },
      },
      choice,
    );
    drafts.delete(d.id);
    pushLog("system", `+ Uploaded invoice ${m.invoiceNumber} from ${m.name} added as a bill (${m.vendorId ? "supplier on file" : "new supplier"})`);
    ledger.event("system", `Owner added uploaded invoice ${m.invoiceNumber} (${d.fileName}) from ${m.name}`, m.id);
    if (choice.kind === "new" && choice.allowlist) {
      const current = loadPolicy();
      if (!current.allowlist.some((e) => e.merchantId === m.id)) {
        const p = savePolicy({ ...current, allowlist: [...current.allowlist, { merchantId: m.id, name: m.name, payTo: m.payTo! }] });
        pushLog("system", `Policy saved as v${p.version}: ${m.name} added to the allowlist`);
      }
    }
    merchantsCache.at = 0;
    return m;
  }),
);

app.get("/api/mandates/:id", (req, res) => send(res, (): Promise<MandateView> => mandateView(String(req.params.id))));

app.post("/api/reset", (_req, res) =>
  send(res, () => {
    if (busy) throw new Error("Can't reset while a run is in progress");
    mandates.clear();
    ledger.clear();
    resetPolicy();
    liveLog.length = 0;
    balanceCache.at = 0;
    pushLog("system", "Demo reset: ledger, mandates and policy cleared. On-chain funds untouched.");
    return { ok: true };
  }),
);

// Serve the built dashboard (npm run build) if present; in dev, Vite serves it.
const dist = resolve(process.cwd(), "web/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

await getPublicClient(); // testnet guard
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard API on http://127.0.0.1:${PORT}${existsSync(dist) ? "  (serving web/dist)" : ""}${READ_ONLY ? "  READ-ONLY" : ""}`);
});
