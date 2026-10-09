import Link from "next/link";
import type { SVGProps } from "react";
import { ar } from "@/market/format";

const P = {
  back: <path d="M9 6l6 6-6 6" />,
  next: <path d="M15 6l-6 6 6 6" />,
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
} as const;

export function Icon({ name, size = 20, ...rest }: { name: keyof typeof P; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}

export function SiteHeader({ brand }: { brand: string }) {
  return (
    <header className="site-head">
      <div className="wrap">
        <Link href="/" className="logo" prefetch={false}>
          {brand}
        </Link>
        <nav className="site-nav" aria-label="الأقسام">
          <Link href="/?region=north-coast" prefetch={false}>
            الساحل الشمالي
          </Link>
          <Link href="/?region=ain-sokhna" prefetch={false}>
            العين السخنة
          </Link>
          <Link href="/#trust" prefetch={false}>
            إزاي بنضمن حجزك
          </Link>
        </nav>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="pill" href="/list-your-chalet" prefetch={false}>
            اعرض شاليهك
          </Link>
          <Link className="pill dark" href="/login" prefetch={false}>
            دخول
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ brand, phone }: { brand: string; phone: string }) {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div>
          {brand} · <a href={`tel:${phone}`}>{ar(phone)}</a> · دعم ٧ أيام في الموسم
        </div>
        <div>
          <Link href="/policies#cancellation" prefetch={false}>
            سياسة الإلغاء
          </Link>{" "}
          ·{" "}
          <Link href="/policies#terms" prefetch={false}>
            الشروط
          </Link>{" "}
          ·{" "}
          <Link href="/policies#privacy" prefetch={false}>
            الخصوصية
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err)
    return (
      <div className="flash err" role="alert">
        {err}
      </div>
    );
  if (ok)
    return (
      <div className="flash ok" role="status">
        {ok}
      </div>
    );
  return null;
}
