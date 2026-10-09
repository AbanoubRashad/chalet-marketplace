import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/SideNav";
import { destroySession, requireRole } from "@/server/session";

export const metadata: Metadata = { title: "المعاينة", robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function InspectorLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireRole(["inspector", "admin"]);
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="title">المعاينة</div>
        <SideNav label="المعاينة" items={[["/inspector", "الوحدات"], ...(user.role === "admin" ? ([["/admin", "لوحة الإدارة"]] as [string, string][]) : [])]} />
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
