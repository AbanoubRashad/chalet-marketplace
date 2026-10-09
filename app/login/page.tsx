import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { get } from "@/lib/db";
import { verifyPassword } from "@/lib/crypto";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/market/repo";
import { db } from "@/server/db";
import { createSession, currentUser } from "@/server/session";

export const metadata: Metadata = { title: "دخول", robots: { index: false } };
const HOME = { owner: "/owner", inspector: "/inspector", admin: "/admin" } as const;

async function login(f: FormData) {
  "use server";
  if (!rateLimit(`login:${clientIp(await headers())}`, 10, 600_000).ok) redirect("/login?e=rate");
  const u = get<{ id: number; name: string; role: keyof typeof HOME; password_hash: string }>(db(), "SELECT * FROM users WHERE email = ? AND active = 1", String(f.get("email") ?? "").trim().toLowerCase());
  if (!u || !verifyPassword(String(f.get("password") ?? ""), u.password_hash)) redirect("/login?e=bad");
  await createSession(u.id);
  audit(db(), { userId: u.id, name: u.name }, "user.login", "user", u.id);
  redirect(HOME[u.role]);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const user = await currentUser();
  if (user) redirect(HOME[user.role]);
  return (
    <main className="login-wrap">
      <form className="panel" action={login}>
        <Link href="/" className="logo" prefetch={false}>
          مصيف
        </Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>دخول الملاك وفريق مصيف</h1>
        {e ? <div className="flash err" role="alert">{e === "rate" ? "محاولات كتير، استنى شوية." : "الإيميل أو كلمة المرور غير صحيحة."}</div> : null}
        <label className="field">
          البريد الإلكتروني
          <input name="email" type="email" required autoComplete="username" dir="ltr" />
        </label>
        <label className="field">
          كلمة المرور
          <input name="password" type="password" required autoComplete="current-password" dir="ltr" />
        </label>
        <button className="pill dark lg" type="submit">
          دخول
        </button>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          الضيوف مش محتاجين حساب: تفاصيل رحلتك بتوصلك على واتساب برابط خاص.
        </p>
      </form>
    </main>
  );
}
