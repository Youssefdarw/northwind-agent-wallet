import { describe, expect, it } from "vitest";
import { forecast, type CashflowBill } from "./cashflow.js";

const bill = (billId: string, amountUsd: number, over: Partial<CashflowBill> = {}): CashflowBill => ({
  billId,
  name: billId,
  status: "not_started",
  amountUsd,
  onChainUsdc: amountUsd * 0.0001,
  dueDate: null,
  ...over,
});
const base = { committedUsd: 0, budgetUsd: 6000, treasuryUsdc: 20, today: "2026-11-15" };

describe("Cash-flow forecast", () => {
  it("all clear when open bills fit the budget and the treasury", () => {
    const f = forecast({ ...base, bills: [bill("office", 36), bill("parts", 4850)] });
    expect(f.open).toMatchObject({ count: 2, usd: 4886 });
    expect(f.warnings.map((w) => w.code)).toEqual(["all_clear"]);
    expect(f.budgetLeftAfterUsd).toBe(1114);
  });

  it("names the bill that would tip the month over budget (in due-date order)", () => {
    const f = forecast({
      ...base,
      committedUsd: 368.4,
      bills: [bill("parts", 4850, { dueDate: "2026-11-19", name: "Fabrikam" }), bill("parts_po", 1480, { dueDate: "2026-12-12", name: "Fabrikam #2" })],
    });
    const w = f.warnings.find((x) => x.code === "over_budget")!;
    expect(w.billId).toBe("parts_po");
    expect(w.message).toMatch(/over the \$6,000 monthly budget/);
  });

  it("warns when the treasury can't cover the open bills, and says which bill runs out", () => {
    const f = forecast({ ...base, treasuryUsdc: 0.3, bills: [bill("a", 1000, { dueDate: "2026-11-16" }), bill("b", 4000, { dueDate: "2026-11-20" })] });
    const w = f.warnings.find((x) => x.code === "treasury_short")!;
    expect(w.billId).toBe("b");
    expect(w.message).toMatch(/short by 0\.2 test USDC/);
  });

  it("flags bills due soon or overdue; held bills get their own warning, routine ones share a line", () => {
    const f = forecast({
      ...base,
      bills: [
        bill("parts", 4850, { name: "Fabrikam", status: "awaiting_approval", dueDate: "2026-11-17" }),
        bill("hosting", 12, { name: "Hosting", dueDate: "2026-11-15" }),
        bill("freight", 320, { name: "Freight", dueDate: "2026-11-10" }),
        bill("later", 50, { dueDate: "2026-12-30" }),
      ],
    });
    expect(f.warnings.find((w) => w.billId === "parts")).toMatchObject({ level: "warn", code: "due_soon", message: expect.stringMatching(/in 2 days .* waiting for your approval/) });
    const routine = f.warnings.filter((w) => w.code === "due_soon" && !w.billId);
    expect(routine).toHaveLength(1);
    expect(routine[0]!.message).toMatch(/Hosting \$12 \(today\)/);
    expect(f.warnings.find((w) => w.billId === "freight")).toMatchObject({ code: "overdue", message: expect.stringMatching(/5 days ago/) });
    expect(f.warnings.some((w) => w.message.includes("later"))).toBe(false);
  });

  it("ignores bills that are paid, paying, blocked or rejected", () => {
    const f = forecast({
      ...base,
      bills: (["paid", "paying", "blocked", "rejected"] as const).map((status) => bill(status, 9999, { status, dueDate: "2026-11-01" })),
    });
    expect(f.open.count).toBe(0);
    expect(f.warnings).toHaveLength(1);
    expect(f.warnings[0]).toMatchObject({ level: "ok", code: "all_clear", message: "Nothing left to pay this month.", messageAr: expect.stringContaining("مفيش") });
  });

  it("mentions bills left out because their supplier isn't allowlisted", () => {
    const f = forecast({ ...base, bills: [bill("a", 10)], notCounted: ["cheap-machine-parts.example"] });
    expect(f.warnings.find((w) => w.code === "not_counted")?.message).toMatch(/cheap-machine-parts\.example\. The supplier isn't on the allowlist/);
  });

  it("works without a treasury reading", () => {
    const f = forecast({ ...base, treasuryUsdc: null, bills: [bill("a", 10)] });
    expect(f.treasuryLeftAfterUsdc).toBeNull();
    expect(f.warnings[0]!.code).toBe("all_clear");
  });
});
