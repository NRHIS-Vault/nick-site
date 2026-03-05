import React from 'react';

const Contact: React.FC = () => {
  return (
    <section id="contact" className="py-20 bg-surface text-foreground">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Get Started Today</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Ready to transform your business with AI? Connect with RHNIS and discover the possibilities.
          </p>
        </div>
        
        <div className="grid lg:grid-cols-2 gap-12">
          <div>
            <h3 className="text-2xl font-bold mb-6">Contact Information</h3>
            <div className="space-y-4">
              <div className="flex items-center">
                <svg className="w-6 h-6 mr-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>contact@nick-ai.link</span>
              </div>
              <div className="flex items-center">
                <svg className="w-6 h-6 mr-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                </svg>
                <span>nick-ai.link</span>
              </div>
            </div>
            
            <div className="mt-8">
              <h4 className="text-lg font-semibold mb-4">Quick Access</h4>
              <div className="flex flex-col sm:flex-row gap-4">
                <a 
                  href="https://dashboard.nick-ai.link" 
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg transition-colors text-center"
                >
                  Access Dashboard
                </a>
                <button className="border border-border text-foreground hover:bg-foreground hover:text-background px-6 py-3 rounded-lg transition-colors">
                  Schedule Demo
                </button>
              </div>
            </div>
          </div>
          
          <div className="bg-card border border-border p-8 rounded-2xl shadow-lg">
            <h3 className="text-2xl font-bold mb-6">Send a Message</h3>
            <form className="space-y-4">
              <input 
                type="text" 
                placeholder="Your Name"
                className="w-full px-4 py-3 bg-surface-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input 
                type="email" 
                placeholder="Your Email"
                className="w-full px-4 py-3 bg-surface-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <textarea 
                placeholder="Your Message"
                rows={4}
                className="w-full px-4 py-3 bg-surface-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              ></textarea>
              <button 
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 rounded-lg transition-colors"
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contact;
