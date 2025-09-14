import React from 'react';

const Features: React.FC = () => {
  const features = [
    {
      title: "Intelligent Automation",
      description: "Streamline complex workflows with AI-powered automation that learns and adapts to your business needs.",
      image: "https://d64gsuwffb70l.cloudfront.net/68c6325570414da3ef26031f_1757819520185_ab73b086.webp"
    },
    {
      title: "Predictive Analytics",
      description: "Make data-driven decisions with advanced machine learning models that forecast trends and outcomes.",
      image: "https://d64gsuwffb70l.cloudfront.net/68c6325570414da3ef26031f_1757819521934_e1c17a40.webp"
    },
    {
      title: "Natural Language Processing",
      description: "Transform text data into actionable insights with state-of-the-art NLP capabilities.",
      image: "https://d64gsuwffb70l.cloudfront.net/68c6325570414da3ef26031f_1757819523884_e4c691a5.webp"
    },
    {
      title: "Real-time Intelligence",
      description: "Monitor and respond to changes instantly with real-time AI processing and alerts.",
      image: "https://d64gsuwffb70l.cloudfront.net/68c6325570414da3ef26031f_1757819526400_b17cf39a.webp"
    }
  ];

  return (
    <section id="features" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Powerful AI Features
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Discover how RHNIS transforms your business with cutting-edge artificial intelligence capabilities
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {features.map((feature, index) => (
            <div key={index} className={`flex flex-col ${index % 2 === 1 ? 'md:order-2' : ''} gap-8`}>
              <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
                <div className="flex items-center mb-6">
                  <img 
                    src={feature.image} 
                    alt={feature.title}
                    className="w-16 h-16 rounded-lg mr-4"
                  />
                  <h3 className="text-2xl font-bold text-gray-900">{feature.title}</h3>
                </div>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;