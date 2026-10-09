import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SideNav } from "@/components/SideNav";
import { destroySession, requireOwner } from "@/server/session";

export const metadata: Metadata = { title: "لوحة المالك", robots: { index: false } };

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { owner } = await requireOwner();
  return (
    <div className="dash">
      <aside className="dash-side">
        <div className="title">لوحة المالك</div>
        <SideNav
          label="لوحة المالك"
          items={[
            ["/owner", "التقويم والأسعار"],
            ["/owner/bookings", "الحجوزات"],
            ["/owner/payouts", "المدفوعات"],
            ["/owner/listing", "بيانات الوحدة والصور"],
            ["/owner/reviews", "التقييمات"],
            ["/owner/verification", "التحقق والمستندات"],
          ]}
        />
        <div className="me">
          <span>{owner.display_name}</span>
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
