import React from 'react';
import Navigation from './Navigation';
import Hero from './Hero';
import Features from './Features';
import About from './About';
import Contact from './Contact';
import Footer from './Footer';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';

const AppLayout: React.FC = () => {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <header>
          <Navigation />
        </header>
        <main id="main-content" tabIndex={-1}>
          <Hero />
          <Features />
          <About />
          <Contact />
        </main>
        <Footer />
      </div>
      {/* Toasts live inside the theme provider so they mirror the active palette. */}
      <Toaster />
      <Sonner />
    </ThemeProvider>
  );
};

export default AppLayout;
