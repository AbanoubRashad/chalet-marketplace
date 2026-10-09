// Paymob (Accept) adapter. Generic: knows nothing about clinics.
//
// API used: Paymob "Intention" API (POST https://accept.paymob.com/v1/intention/) + Unified Checkout,
// and the legacy-compatible "transaction processed" callback whose HMAC is SHA-512 over a fixed,
// ordered list of fields. Verify both against Paymob's current docs before going live (see TODO.md).
import { hmacHex, safeEqualHex } from "@/lib/crypto";

export const PAYMOB_HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

export type PaymobMethod = "card" | "wallet" | "kiosk";

/** Subset of the transaction object we rely on. */
export interface PaymobTransaction {
  id: number | string;
  amount_cents: number;
  created_at: string;
  currency: string;
  error_occured: boolean;
  has_parent_transaction: boolean;
  integration_id: number | string;
  is_3d_secure: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_refunded: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  owner: number | string;
  pending: boolean;
  success: boolean;
  order: { id: number | string; merchant_order_id?: string | null };
  source_data: { pan: string; sub_type: string; type: string };
  data?: { bill_reference?: string | number | null; message?: string };
  [k: string]: unknown;
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function computeTransactionHmac(obj: unknown, secret: string): string {
  return hmacHex("sha512", secret, PAYMOB_HMAC_FIELDS.map((f) => stringify(pick(obj, f))).join(""));
}

export function verifyTransactionHmac(obj: unknown, received: string | null | undefined, secret: string): boolean {
  if (!received) return false;
  return safeEqualHex(computeTransactionHmac(obj, secret), received.toLowerCase());
}

/** Strip card/wallet identifiers before storing the raw payload. */
export function redactTransaction(obj: PaymobTransaction): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const sd = clone.source_data as Record<string, unknown> | undefined;
  if (sd) sd.pan = typeof sd.pan === "string" ? `••••${sd.pan.slice(-4)}` : "";
  delete clone.billing_data;
  delete clone.shipping_data;
  delete clone.payment_key_claims;
  const order = clone.order as Record<string, unknown> | undefined;
  if (order) {
    delete order.shipping_data;
    delete order.billing_data;
  }
  return clone;
}

export interface PaymobConfig {
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrations: Partial<Record<PaymobMethod, number>>;
}

export function paymobConfigFromEnv(): PaymobConfig | null {
  const secretKey = process.env.PAYMOB_SECRET_KEY;
  const publicKey = process.env.PAYMOB_PUBLIC_KEY;
  if (!secretKey || !publicKey) return null;
  const n = (v?: string) => (v ? Number(v) : undefined);
  return {
    secretKey,
    publicKey,
    hmacSecret: process.env.PAYMOB_HMAC_SECRET ?? "",
    integrations: {
      card: n(process.env.PAYMOB_INTEGRATION_CARD),
      wallet: n(process.env.PAYMOB_INTEGRATION_WALLET),
      kiosk: n(process.env.PAYMOB_INTEGRATION_KIOSK),
    },
  };
}

export interface IntentionInput {
  amountCents: number;
  method: PaymobMethod;
  merchantReference: string; // becomes order.merchant_order_id in callbacks
  itemName: string;
  customer: { firstName: string; lastName: string; phone: string; email: string };
  notificationUrl: string;
  redirectionUrl: string;
}

export interface IntentionResult {
  checkoutUrl: string;
  intentionId: string;
  sandbox: boolean;
}

/** Creates a payment intention. With no Paymob keys configured, returns a local sandbox checkout URL. */
export async function createIntention(input: IntentionInput, sandboxCheckoutUrl: string): Promise<IntentionResult> {
  const cfg = paymobConfigFromEnv();
  if (!cfg) return { checkoutUrl: sandboxCheckoutUrl, intentionId: `sandbox_${input.merchantReference}`, sandbox: true };
  const integration = cfg.integrations[input.method];
  if (!integration) throw new Error(`No Paymob integration configured for ${input.method}`);
  const res = await fetch("https://accept.paymob.com/v1/intention/", {
    method: "POST",
    headers: { Authorization: `Token ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountCents,
      currency: "EGP",
      payment_methods: [integration],
      items: [{ name: input.itemName, amount: input.amountCents, quantity: 1 }],
      billing_data: {
        first_name: input.customer.firstName,
        last_name: input.customer.lastName || "-",
        phone_number: input.customer.phone,
        email: input.customer.email,
      },
      special_reference: input.merchantReference,
      notification_url: input.notificationUrl,
      redirection_url: input.redirectionUrl,
    }),
  });
  if (!res.ok) throw new Error(`Paymob intention failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string; client_secret: string };
  return {
    checkoutUrl: `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(cfg.publicKey)}&clientSecret=${encodeURIComponent(body.client_secret)}`,
    intentionId: body.id,
    sandbox: false,
  };
}

/** Refund a captured transaction (amount in cents). Sandbox mode is a no-op that reports success. */
export async function refundTransaction(transactionId: string, amountCents: number): Promise<{ ok: boolean; sandbox: boolean }> {
  const cfg = paymobConfigFromEnv();
  if (!cfg) return { ok: true, sandbox: true };
  const res = await fetch("https://accept.paymob.com/api/acceptance/void_refund/refund", {
    method: "POST",
    headers: { Authorization: `Token ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ transaction_id: transactionId, amount_cents: amountCents }),
  });
  return { ok: res.ok, sandbox: false };
}

/** Builds a realistic transaction object for the local sandbox checkout and tests. */
export function sandboxTransaction(opts: {
  id: number;
  orderId: number;
  merchantOrderId: string;
  amountCents: number;
  method: PaymobMethod;
  success: boolean;
  pending?: boolean;
  billReference?: string;
}): PaymobTransaction {
  const type = opts.method === "card" ? "card" : opts.method === "wallet" ? "wallet" : "aggregator";
  return {
    id: opts.id,
    amount_cents: opts.amountCents,
    created_at: new Date().toISOString().slice(0, 19),
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 0,
    is_3d_secure: opts.method === "card",
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    owner: 0,
    pending: opts.pending ?? false,
    success: opts.success,
    order: { id: opts.orderId, merchant_order_id: opts.merchantOrderId },
    source_data: {
      pan: opts.method === "card" ? "2346" : opts.method === "wallet" ? "01010101010" : "",
      sub_type: opts.method === "card" ? "MasterCard" : opts.method === "wallet" ? "wallet" : "AGGREGATOR",
      type,
    },
    data: { bill_reference: opts.billReference ?? null, message: opts.success ? "Approved" : "Declined" },
  };
}
