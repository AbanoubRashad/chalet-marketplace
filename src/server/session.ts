import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get } from "@/lib/db";
import { hmacHex, safeEqualHex, secret } from "@/lib/crypto";
import type { Owner, Role } from "@/market/types";
import { ownerByUser } from "@/market/repo";
import { db } from "./db";

const COOKIE = "ms_session";
const TTL_MS = 12 * 3_600_000;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

const sign = (p: string) => hmacHex("sha256", secret("SESSION_SECRET"), p);

export async function createSession(userId: number) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TTL_MS })).toString("base64url");
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqualHex(sign(payload), sig)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: number; exp: number };
    if (exp < Date.now()) return null;
    return get<SessionUser>(db(), "SELECT id, name, email, role FROM users WHERE id = ? AND active = 1", uid) ?? null;
  } catch {
    return null;
  }
}

export async function requireRole(roles: Role[]) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(user.role === "owner" ? "/owner" : user.role === "inspector" ? "/inspector" : "/admin");
  return { user, actor: { userId: user.id, name: user.name } };
}

export async function requireOwner(): Promise<{ user: SessionUser; owner: Owner; actor: { userId: number; name: string } }> {
  const { user, actor } = await requireRole(["owner"]);
  const owner = ownerByUser(db(), user.id);
  if (!owner) redirect("/login");
  return { user, owner, actor };
}
