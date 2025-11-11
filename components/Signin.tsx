import Image from "next/image";
import React from "react";

export default function PersonalisedNewsHero() {
  return (
    <section className="flex flex-col md:flex-row-reverse items-center justify-center max-w-7xl mx-auto px-6 py-20 md:py-28">
      <div className="w-full md:w-1/2 flex justify-center md:justify-end">
        <div className="relative w-[280px] sm:w-[320px] md:w-[380px] drop-shadow-2xl">
          <Image
            src="/Sign-in.jpeg"
            alt="BrefNews personalised feed app preview"
            width={300}
            height={400}
            className="rounded-3xl object-cover"
            priority
          />
        </div>
      </div>

      <div className="w-full md:w-1/2 text-center md:text-left space-y-6 mt-10 md:mt-0">
        <h2 className="text-3xl sm:text-4xl font-semibold leading-snug text-gray-900">
          Your <span className="text-blue-600">Personalised Feed</span>,  
          powered by your interests.
        </h2>
        <p className="text-gray-600 text-base md:text-lg leading-relaxed max-w-md mx-auto md:mx-0">
          BrefNews learns what you love reading and tailors your feed
          automatically. Inside the app, your login unlocks a smart,
          AI-driven personalised news stream — focused entirely on topics you
          care about most.
        </p>
      </div>
    </section>
  );
}
