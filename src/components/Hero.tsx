import React from 'react';

const Hero: React.FC = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url('https://d64gsuwffb70l.cloudfront.net/68c6325570414da3ef26031f_1757819518268_6b4fe916.webp')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/90 to-blue-600/80"></div>
      </div>
      
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center text-white">
        <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">
          RHNIS
        </h1>
        <p className="text-xl md:text-2xl mb-4 text-blue-100">
          Revolutionary AI Solutions for Tomorrow
        </p>
        <p className="text-lg mb-8 text-blue-200 max-w-2xl mx-auto">
          Empowering businesses with cutting-edge artificial intelligence technology. 
          Experience the future of automation and intelligent decision-making.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a 
            href="https://dashboard.nick-ai.link" 
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg"
          >
            Access Dashboard
          </a>
          <button className="bg-transparent border-2 border-white hover:bg-white hover:text-blue-900 text-white px-8 py-4 rounded-lg font-semibold transition-all duration-300">
            Learn More
          </button>
        </div>
      </div>
    </section>
  );
};

export default Hero;