// Messaging layer: WhatsApp Business Platform (Cloud API) with email fallback, every attempt logged.
// Generic: callers pass the rendered template; nothing here is clinic-specific.
import { run, type DB } from "@/lib/db";
import { hmacHex, randomToken, safeEqualHex, secret } from "@/lib/crypto";
import { maskPhone } from "@/lib/phone";

export interface QuickReply {
  id: string; // payload returned by the webhook when tapped
  title: string;
}

export interface OutboundMessage {
  tenantId: number;
  template: string; // pre-approved WhatsApp template name
  lang: "ar" | "en";
  to: string; // E.164
  email?: string | null;
  params: string[]; // ordered body variables {{1}}, {{2}}...
  body: string; // rendered text (for the log, preview and email fallback)
  buttons?: QuickReply[];
  optedOut?: boolean;
  bookingId?: number | null;
  guestId?: number | null;
  phoneNumberId?: string | null; // tenant's WhatsApp sender
}

export interface SendResult {
  logId: number;
  status: "sent" | "simulated" | "failed" | "skipped_opt_out";
  channel: "whatsapp" | "email";
}

function log(db: DB, m: OutboundMessage, channel: "whatsapp" | "email", status: SendResult["status"], providerId: string | null, error?: string) {
  return run(
    db,
    `INSERT INTO message_log (tenant_id, booking_id, guest_id, channel, template, recipient, lang, body, buttons, status, provider_message_id, error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.tenantId,
    m.bookingId ?? null,
    m.guestId ?? null,
    channel,
    m.template,
    channel === "whatsapp" ? maskPhone(m.to) : (m.email ?? ""),
    m.lang,
    m.body,
    m.buttons ? JSON.stringify(m.buttons) : null,
    status,
    providerId,
    error ?? null,
  ).id;
}

async function sendWhatsAppCloud(m: OutboundMessage): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN!;
  const phoneNumberId = m.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const components: unknown[] = [{ type: "body", parameters: m.params.map((text) => ({ type: "text", text })) }];
  (m.buttons ?? []).forEach((b, index) =>
    components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload: b.id }] }),
  );
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: m.to.replace("+", ""),
      type: "template",
      template: { name: m.template, language: { code: m.lang === "ar" ? "ar" : "en" }, components },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { messages?: { id: string }[] };
  return body.messages?.[0]?.id ?? "unknown";
}

async function sendEmail(m: OutboundMessage): Promise<string> {
  // No SMTP provider is wired in yet: the email is recorded in the log (see TODO.md).
  return `email_${randomToken(8)}`;
}

export function whatsappLive(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Sends one message. Opted-out recipients are skipped (and logged). WhatsApp first; on failure
 * (or when the patient has no WhatsApp) falls back to email when an address is known.
 */
export async function sendMessage(db: DB, m: OutboundMessage): Promise<SendResult> {
  if (m.optedOut) {
    if (m.email) {
      const id = await sendEmail(m);
      return { logId: log(db, m, "email", "sent", id), status: "sent", channel: "email" };
    }
    return { logId: log(db, m, "whatsapp", "skipped_opt_out", null), status: "skipped_opt_out", channel: "whatsapp" };
  }
  if (!whatsappLive()) {
    const id = `sim_${randomToken(10)}`;
    return { logId: log(db, m, "whatsapp", "simulated", id), status: "simulated", channel: "whatsapp" };
  }
  try {
    const id = await sendWhatsAppCloud(m);
    return { logId: log(db, m, "whatsapp", "sent", id), status: "sent", channel: "whatsapp" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failedId = log(db, m, "whatsapp", "failed", null, msg);
    if (m.email) {
      const id = await sendEmail(m);
      return { logId: log(db, m, "email", "sent", id), status: "sent", channel: "email" };
    }
    return { logId: failedId, status: "failed", channel: "whatsapp" };
  }
}

/** Meta signs webhook bodies with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqualHex(hmacHex("sha256", secret("WHATSAPP_APP_SECRET"), rawBody), header.slice(7));
}

export function signWhatsAppBody(rawBody: string): string {
  return `sha256=${hmacHex("sha256", secret("WHATSAPP_APP_SECRET"), rawBody)}`;
}

export interface InboundReply {
  messageId: string;
  from: string; // E.164 without '+', as Meta sends it
  payload: string | null; // quick-reply payload
  text: string | null;
}

/** Extracts button replies / texts from a WhatsApp Cloud API webhook body. */
export function parseWhatsAppWebhook(body: unknown): InboundReply[] {
  const out: InboundReply[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: { messages?: Record<string, unknown>[] } }[] }[]) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        const button = msg.button as { payload?: string; text?: string } | undefined;
        const interactive = msg.interactive as { button_reply?: { id?: string } } | undefined;
        const text = msg.text as { body?: string } | undefined;
        out.push({
          messageId: String(msg.id ?? ""),
          from: String(msg.from ?? ""),
          payload: button?.payload ?? interactive?.button_reply?.id ?? null,
          text: text?.body ?? button?.text ?? null,
        });
      }
    }
  }
  return out;
}
