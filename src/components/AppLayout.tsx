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
        <Navigation />
        <Hero />
        <Features />
        <About />
        <Contact />
        <Footer />
      </div>
      {/* Toasts live inside the theme provider so they mirror the active palette. */}
      <Toaster />
      <Sonner />
    </ThemeProvider>
  );
};

export default AppLayout;
