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
        <div className="absolute inset-0 bg-gradient-to-r from-brand-strong/90 to-brand/80"></div>
      </div>
      
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center text-foreground drop-shadow-sm">
        <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-foreground to-primary/80 bg-clip-text text-transparent">
          RHNIS
        </h1>
        <p className="text-xl md:text-2xl mb-4 text-foreground/80">
          Revolutionary AI Solutions for Tomorrow
        </p>
        <p className="text-lg mb-8 text-muted-foreground max-w-2xl mx-auto">
          Empowering businesses with cutting-edge artificial intelligence technology. 
          Experience the future of automation and intelligent decision-making.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a 
            href="https://dashboard.nick-ai.link" 
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-4 rounded-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg shadow-primary/30"
          >
            Access Dashboard
          </a>
          <button className="border-2 border-foreground/70 hover:bg-foreground hover:text-background text-foreground px-8 py-4 rounded-lg font-semibold transition-all duration-300">
            Learn More
          </button>
        </div>
      </div>
    </section>
  );
};

export default Hero;
