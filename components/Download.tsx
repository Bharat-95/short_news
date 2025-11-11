import Image from "next/image";
import React from "react";

export default function DownloadSection() {
  return (
    <section className="flex flex-col items-center justify-center text-center py-16 bg-white">
      <h2 className="text-gray-700 font-semibold text-lg sm:text-xl mb-6">
        Download the easiest way to stay informed
      </h2>
      <div className="flex items-center justify-center gap-4">
        <a
          href="#"
          aria-label="Download on the App Store"
          className="transition-transform hover:scale-105"
        >
          <Image
            src="/ios_app_store.png"
            alt="Download on the App Store"
            width={160}
            height={50}
          />
        </a>
        <a
          href="#"
          aria-label="Get it on Google Play"
          className="transition-transform hover:scale-105"
        >
          <Image
            src="/android_app_store.png"
            alt="Get it on Google Play"
            width={160}
            height={50}
          />
        </a>
      </div>
    </section>
  );
}
