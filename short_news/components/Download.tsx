"use client";
import React from "react";
import Image from "next/image";
import { motion } from "framer-motion";

export default function DownloadSection() {
  const textVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0 },
  };

  const btnVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 },
  };

  return (
    <section className="flex flex-col items-center justify-center text-center py-16 bg-white">
      <motion.h2
        className="text-gray-700 font-semibold text-lg sm:text-xl mb-6"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        variants={textVariants}
      >
        Download the easiest way to stay informed
      </motion.h2>

      <motion.div
        className="flex items-center justify-center gap-4"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.1, staggerChildren: 0.2 }}
        variants={{
          visible: { transition: { staggerChildren: 0.2 } },
        }}
      >
        <motion.a
          href="#"
          aria-label="Download on the App Store"
          className="transition-transform hover:scale-105"
          variants={btnVariants}
        >
          <Image
            src="/ios_app_store.png"
            alt="Download on the App Store"
            width={160}
            height={50}
          />
        </motion.a>

        <motion.a
          href="#"
          aria-label="Get it on Google Play"
          className="transition-transform hover:scale-105"
          variants={btnVariants}
        >
          <Image
            src="/android_app_store.png"
            alt="Get it on Google Play"
            width={160}
            height={50}
          />
        </motion.a>
      </motion.div>
    </section>
  );
}
