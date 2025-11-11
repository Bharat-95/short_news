import type { Metadata } from "next";
import "./globals.css";
import Footer from "@/components/Footer";



export const metadata: Metadata = {
  title: "Bref News",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="px-20">
      <body
        className={` antialiased`}
      >
        
        {children}
        <Footer/>
      </body>
    </html>
  );
}
