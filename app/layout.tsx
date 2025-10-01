import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";



export const metadata: Metadata = {
  title: "Short News",
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
