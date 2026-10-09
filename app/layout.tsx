import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Almarai, El_Messiri } from "next/font/google";

const almarai = Almarai({ subsets: ["arabic"], weight: ["400", "700", "800"], variable: "--font-almarai", display: "optional" });
const messiri = El_Messiri({ subsets: ["arabic"], weight: ["500", "700"], variable: "--font-messiri", display: "optional" });

export const metadata: Metadata = {
  title: { default: "مصيف · شاليهات الساحل والسخنة متصوّرة ومتراجعة", template: "%s · مصيف" },
  description: "احجز شاليه في الساحل الشمالي أو العين السخنة: كل وحدة زرناها وصورناها، والدفع محفوظ لحد ما تستلم، والتقييمات من ناس سكنت فعلًا.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0D2B3E" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${almarai.variable} ${messiri.variable}`}>
      <body>{children}</body>
    </html>
  );
}
