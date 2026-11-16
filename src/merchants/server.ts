/**
 * A mock merchant: a tiny Express server whose invoice endpoint is protected by x402.
 *
 *   GET  /invoice        → free: the invoice as JSON (what the agent reads)
 *   GET  <paidPath>      → x402-protected: 402 + price until paid, then a receipt
 *
 * Settlement goes through the public x402 testnet facilitator, which submits the
 * USDC transfer on Base Sepolia and pays the gas. Funds land in the merchant's own wallet.
 */
import express from "express";
import type { Server } from "node:http";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { assertTestnetConfig, X402_NETWORK } from "../config/network.js";
import {
  FACILITATOR_URL,
  amountLabel,
  atomicToUsdc,
  merchantAddress,
  onChainAtomic,
  vendorIdOf,
  type Merchant,
} from "../config/scenario.js";

export function invoiceJson(m: Merchant) {
  return {
    merchant: m.name,
    // The supplier this bill is from (for uploaded invoices: the supplier on file).
    merchantId: vendorIdOf(m),
    billId: m.id,
    domain: m.domain,
    invoiceNumber: m.invoiceNumber,
    poNumber: m.poNumber,
    billType: m.billType,
    description: m.description,
    amountUsd: m.amountUsd,
    expectedCalls: m.expectedCalls,
    onChainAmountUsdc: atomicToUsdc(onChainAtomic(m)),
    amountLabel: amountLabel(m),
    currency: "USD",
    payTo: merchantAddress(m),
    network: X402_NETWORK,
    payUrlPath: m.paidPath,
  };
}

export function startMerchant(m: Merchant): Promise<Server> {
  assertTestnetConfig();
  const payTo = merchantAddress(m);
  const price = `$${atomicToUsdc(onChainAtomic(m))}`;

  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());

  const app = express();

  app.get("/invoice", (_req, res) => {
    res.json(invoiceJson(m));
  });

  app.use(
    paymentMiddleware(
      {
        [`GET ${m.paidPath}`]: {
          // 60s: a signed payment authorization for this merchant expires a minute after signing.
          accepts: { scheme: "exact", price, network: X402_NETWORK, payTo, maxTimeoutSeconds: 60 },
          description: `${m.name}: ${m.invoiceNumber}`,
          mimeType: "application/json",
        },
      },
      resourceServer,
    ),
  );

  app.get(m.paidPath, (_req, res) => {
    console.log(`[${m.id}] ✓ paid request served (${price} test USDC → ${payTo})`);
    if (m.billType === "pay_per_use") {
      res.json({ quoteId: `Q-${Date.now()}`, part: "Air-end bearing kit", unitPriceUsd: 412.5, currency: "USD" });
    } else {
      res.json({ receipt: true, merchant: m.name, invoiceNumber: m.invoiceNumber, status: "PAID" });
    }
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(m.port, () => {
      console.log(`[${m.id}] ${m.name} on :${m.port}  ${amountLabel(m)}  payTo ${payTo}`);
      resolve(server);
    });
    server.once("error", reject); // e.g. port already in use
  });
}
