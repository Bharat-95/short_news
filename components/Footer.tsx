import React from "react";
import Image from "next/image";
import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start">
            <Image
              src="/Logo.png"
              alt="BrefNews Logo"
              width={160}
              height={80}
              className="mb-3"
            />
            <p className="text-sm text-gray-600 text-center md:text-left max-w-xs">
              BrefNews brings you short, verified news stories — smartly curated
              for your interests. Stay updated, stay informed.
            </p>
          </div>

          <div className="flex flex-col items-center md:items-end gap-3">
            <div className="flex gap-4">
              <a
                href="#"
                aria-label="Facebook"
                className="text-gray-500 hover:text-blue-600 transition"
              >
                <Facebook size={20} />
              </a>
              <a
                href="#"
                aria-label="Twitter"
                className="text-gray-500 hover:text-blue-500 transition"
              >
                <Twitter size={20} />
              </a>
              <a
                href="#"
                aria-label="Instagram"
                className="text-gray-500 hover:text-pink-500 transition"
              >
                <Instagram size={20} />
              </a>
              <a
                href="#"
                aria-label="LinkedIn"
                className="text-gray-500 hover:text-blue-700 transition"
              >
                <Linkedin size={20} />
              </a>
            </div>
            <div className="flex gap-4 pt-4">
              <Image
                src="/ios_app_store.png"
                alt="App Store"
                width={130}
                height={40}
                className="cursor-pointer hover:scale-105 transition"
              />
              <Image
                src="/android_app_store.png"
                alt="Google Play"
                width={130}
                height={40}
                className="cursor-pointer hover:scale-105 transition"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} BrefNews. All rights reserved.</p>
          <div className="flex gap-6 mt-3 sm:mt-0">
            <a href="#" className="hover:text-gray-700 transition">
              Privacy Policy
            </a>
            <a href="#" className="hover:text-gray-700 transition">
              Terms of Service
            </a>
            <a href="#" className="hover:text-gray-700 transition">
              Contact Us
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
