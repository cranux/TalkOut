import type { Metadata, Viewport } from "next";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "嘴遁 · TalkOut",
  description: "用一张嘴,说服一个死活不肯松口的 AI。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 不再锁死缩放,允许用户放大(无障碍)
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      data-theme="light"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* 无闪烁:首帧前从 localStorage 还原主题 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('talkout_theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
