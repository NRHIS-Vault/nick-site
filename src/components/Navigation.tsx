import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

const Navigation: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const toggleMobileMenu = () => setIsOpen((currentValue) => !currentValue);
  const closeMobileMenu = () => setIsOpen(false);

  return (
    <nav
      aria-label="Primary"
      className="fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-sm border-b border-border shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <span className="text-2xl font-bold bg-gradient-to-r from-brand-strong to-primary bg-clip-text text-transparent">
              RHNIS
            </span>
          </div>
          
          <div className="hidden md:flex items-center space-x-8">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#about" className="text-muted-foreground hover:text-foreground transition-colors">About</a>
            <a href="#contact" className="text-muted-foreground hover:text-foreground transition-colors">Contact</a>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <a 
              href="https://dashboard.nick-ai.link" 
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-lg transition-colors"
            >
              Dashboard
            </a>
          </div>
          
          <button 
            type="button"
            className="md:hidden rounded-md p-2 text-foreground transition-colors hover:bg-surface-muted"
            onClick={toggleMobileMenu}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.preventDefault()} // Avoid text selection on mobile
            aria-controls="mobile-navigation"
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        
        {isOpen && (
          <div
            id="mobile-navigation"
            className="md:hidden py-4 border-t border-border bg-surface text-foreground"
          >
            <div className="flex flex-col space-y-4">
              <a
                href="#features"
                onClick={closeMobileMenu}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Features
              </a>
              <a
                href="#about"
                onClick={closeMobileMenu}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                About
              </a>
              <a
                href="#contact"
                onClick={closeMobileMenu}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Contact
              </a>
              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                  closeMobileMenu();
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                {theme === 'light' ? 'Dark theme' : 'Light theme'}
              </button>
              <a
                href="https://dashboard.nick-ai.link"
                onClick={closeMobileMenu}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-center hover:bg-primary/90 transition-colors"
              >
                Dashboard
              </a>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navigation;
