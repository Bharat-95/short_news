"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";

export default function HeroSection() {
  const imgVariants = {
    hidden: { opacity: 0, x: 80, scale: 0.98 },
    visible: { opacity: 1, x: 0, scale: 1 },
  };

  const textVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <section className="flex flex-col-reverse md:flex-row items-center justify-center md:justify-between max-w-7xl mx-auto px-6 py-10">
      <motion.div
        className="w-full md:w-1/2 flex justify-center md:justify-start"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.25 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        variants={imgVariants}
      >
        <div className="relative w-[280px] sm:w-[320px] md:w-[360px] drop-shadow-2xl">
          <Image
            src="/Hero.jpeg"
            alt="BrefNews mobile app preview"
            width={300}
            height={400}
            className="rounded-3xl object-cover"
          />
        </div>
      </motion.div>

      <motion.div
        className="w-full md:w-1/2 text-center md:text-left space-y-6 mt-10 md:mt-0"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.2 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.12 }}
        variants={textVariants}
      >
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold text-gray-900 leading-snug">
          Stay updated in <span className="text-blue-600">just 60 seconds.</span>
        </h1>
        <p className="text-gray-600 text-base md:text-lg leading-relaxed max-w-md mx-auto md:mx-0">
          BrefNews brings you crisp, summarized updates from around the world —
          business, politics, entertainment, tech, and more — all in one place.
          Fast, smart, and made for the modern reader.
        </p>
        <div className="flex items-center justify-center md:justify-start gap-4 pt-4">
          <Link href="#">
            <Image
              src="/ios_app_store.png"
              alt="Download on App Store"
              width={150}
              height={45}
            />
          </Link>
          <Link href="#">
            <Image
              src="/android_app_store.png"
              alt="Get it on Google Play"
              width={150}
              height={45}
            />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
