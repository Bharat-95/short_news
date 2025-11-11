import Image from "next/image";

export default function CategoryNewsSection() {
  return (
    <section className="flex flex-col-reverse md:flex-row items-center justify-center md:justify-between max-w-7xl mx-auto px-6 py-16 md:py-24">
      <div className="w-full md:w-1/2 flex justify-center md:justify-start">
        <div className="relative w-[280px] sm:w-[320px] md:w-[360px] drop-shadow-2xl">
          <Image
            src="/Category.jpeg"
            alt="BrefNews category selection preview"
            width={300}
            height={400}
            className="rounded-3xl object-cover"
          />
        </div>
      </div>

      <div className="w-full md:w-1/2 text-center md:text-left space-y-6 mt-10 md:mt-0">
        <h2 className="text-3xl sm:text-4xl font-semibold leading-snug text-gray-900">
          Browse <span className="text-blue-600">Your World,</span>  
          <br /> One Category at a Time.
        </h2>
        <p className="text-gray-600 text-base md:text-lg leading-relaxed max-w-md mx-auto md:mx-0">
          Stay informed in your favorite domains — from business and technology
          to sports, politics, entertainment, and more.  
          BrefNews neatly organizes stories by category so you can dive deeper
          into what truly interests you, without the noise.
        </p>
      </div>
    </section>
  );
}
