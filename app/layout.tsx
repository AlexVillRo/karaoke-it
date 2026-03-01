import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KaraokeIT",
  description: "Canta, puntúa, gana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased bg-[#0a0a0f]">
        {children}
      </body>
    </html>
  );
}
