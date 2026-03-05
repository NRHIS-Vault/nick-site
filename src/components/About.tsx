import React from 'react';

const About: React.FC = () => {
  return (
    <section id="about" className="py-20 bg-background">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl font-bold text-foreground mb-6">
              About RHNIS
            </h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              RHNIS represents the next generation of artificial intelligence solutions, 
              designed to empower businesses with intelligent automation and data-driven insights.
            </p>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              Built by Nick, a passionate AI developer, RHNIS combines cutting-edge machine learning 
              technologies with practical business applications to deliver measurable results.
            </p>
            
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="bg-surface-muted border border-border p-6 rounded-lg">
                <h3 className="font-semibold text-foreground mb-2">Innovation First</h3>
                <p className="text-muted-foreground">Leveraging the latest AI research and technologies</p>
              </div>
              <div className="bg-surface-muted border border-border p-6 rounded-lg">
                <h3 className="font-semibold text-foreground mb-2">Business Focused</h3>
                <p className="text-muted-foreground">Practical solutions that drive real business value</p>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-brand-strong to-primary rounded-2xl p-8 text-primary-foreground shadow-xl shadow-primary/30">
            <h3 className="text-2xl font-bold mb-6">Why Choose RHNIS?</h3>
            <ul className="space-y-4">
              <li className="flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary-foreground/80" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Advanced AI algorithms tailored to your needs
              </li>
              <li className="flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary-foreground/80" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Seamless integration with existing systems
              </li>
              <li className="flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary-foreground/80" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                24/7 intelligent monitoring and support
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;
