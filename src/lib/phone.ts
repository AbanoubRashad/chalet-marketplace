/**
 * Egyptian mobile numbers: 010, 011, 012, 015 + 8 digits.
 * Accepts local (01xxxxxxxxx), international (+201xxxxxxxxx / 00201...) and Arabic-Indic digits.
 * Returns E.164 (+201xxxxxxxxx) or null.
 */
export function normalizeEgyptianMobile(input: string): string | null {
  const ascii = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-().]/g, "");
  let n = ascii;
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("20")) n = n.slice(2);
  if (n.startsWith("0")) n = n.slice(1);
  if (!/^1[0125]\d{8}$/.test(n)) return null;
  return `+20${n}`;
}

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 5)}•••••${e164.slice(-3)}` : "•••";
}

/** +201001234567 -> 01001234567 (how Egyptians read numbers) */
export function localFormat(e164: string): string {
  return e164.startsWith("+20") ? `0${e164.slice(3)}` : e164;
}
