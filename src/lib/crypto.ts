import crypto from "node:crypto";

const DEV_FALLBACK = "dev-only-insecure-key-change-me";

function key(name: string): Buffer {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === "production") throw new Error(`${name} must be set in production`);
  return crypto.createHash("sha256").update(v || `${DEV_FALLBACK}:${name}`).digest();
}

/** AES-256-GCM field encryption for contact details at rest. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("FIELD_ENCRYPTION_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptField(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("FIELD_ENCRYPTION_KEY"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Deterministic keyed hash so we can look up / enforce uniqueness without storing plaintext. */
export function blindIndex(value: string): string {
  return crypto.createHmac("sha256", key("PHONE_INDEX_KEY")).update(value).digest("hex");
}

export function randomToken(bytes = 18): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hmacHex(algo: "sha256" | "sha512", secret: string, data: string): string {
  return crypto.createHmac(algo, secret).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), 32);
  const expected = Buffer.from(hash, "base64url");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function secret(name: string): string {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === "production") throw new Error(`${name} must be set in production`);
  return v || `${DEV_FALLBACK}:${name}`;
}
