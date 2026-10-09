import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/SideNav";
import { destroySession, requireRole } from "@/server/session";

export const metadata: Metadata = { title: "الإدارة", robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(["admin"]);
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="title">إدارة مصيف</div>
        <SideNav
          label="الإدارة"
          items={[
            ["/admin", "نظرة عامة"],
            ["/admin/manual", "حجز يدوي (إدارة كاملة)"],
            ["/admin/messages", "الرسائل"],
            ["/admin/demo-feed", "محاكي Airbnb"],
            ["/inspector", "المعاينة"],
          ]}
        />
        <div className="me">
          <span>{user.name}</span>
          <form action={logout}>
            <button type="submit">خروج</button>
          </form>
        </div>
      </aside>
      <main className="dash-main" id="main">
        {children}
      </main>
    </div>
  );
}
