import Image from "next/image";

export default function PersonalisedFeedSection() {
  return (
    <section className="flex flex-col md:flex-row items-center justify-center md:justify-between max-w-7xl mx-auto px-6 py-16 md:py-24">
      <div className="w-full md:w-1/2 text-center md:text-left space-y-6 mb-10 md:mb-0">
        <h2 className="text-3xl sm:text-4xl font-semibold leading-snug text-gray-900">
          <span className="text-blue-600">Your Smart Feed,</span>  
          <br /> Tailored Just for You.
        </h2>
        <p className="text-gray-600 text-base md:text-lg leading-relaxed max-w-md mx-auto md:mx-0">
          BrefNews learns your reading habits and curates stories that match your
          interests. The more you read, the smarter your feed becomes.  
          Get your daily dose of news that truly matters — concise, relevant,
          and made just for you.
        </p>
      </div>

      <div className="w-full md:w-1/2 flex justify-center md:justify-end">
        <div className="relative w-[280px] sm:w-[320px] md:w-[360px] drop-shadow-2xl">
          <Image
            src="/Personaised.jpeg"
            alt="BrefNews personalized feed preview"
            width={300}
            height={400}
            className="rounded-3xl object-cover"
          />
        </div>
      </div>
    </section>
  );
}
