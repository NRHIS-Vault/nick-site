// Sample API for Customer Portal services, subscribers, and revenue analytics.

type Service = {
  id: string;
  name: string;
  description: string;
  price: number;
  period: "monthly" | "yearly";
  features: string[];
  popular?: boolean;
  roi: string;
};

type Subscriber = {
  id: string;
  name: string;
  email: string;
  service: string;
  joinDate: string;
  revenue: number;
  status: "active" | "paused" | "cancelled";
};

type Performance = {
  service: string;
  subscribers: number;
  progress: number;
};

type RevenueBreakdown = {
  service: string;
  amount: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async () => {
  const services: Service[] = [
    {
      id: "svc-1",
      name: "AI Trading Signals",
      description: "Get real-time trading signals powered by our advanced AI algorithms. Perfect for crypto and forex trading.",
      price: 97,
      period: "monthly",
      features: ["Real-time signals", "24/7 monitoring", "Multiple platforms", "Risk management", "Mobile alerts"],
      roi: "15-25% monthly",
      popular: false,
    },
    {
      id: "svc-2",
      name: "Lead Generation Pro",
      description: "Automated lead generation for your business using AI-powered social media campaigns.",
      price: 197,
      period: "monthly",
      features: ["Multi-platform posting", "Lead tracking", "CRM integration", "Analytics dashboard", "Custom campaigns"],
      roi: "300-500% ROI",
    },
    {
      id: "svc-3",
      name: "RHNIS Identity Suite",
      description: "Complete digital identity system with voice recognition, avatar, and automation tools.",
      price: 297,
      period: "monthly",
      features: ["Digital avatar", "Voice commands", "Identity tracking", "Legacy preservation", "Device control"],
      roi: "Priceless digital legacy",
    },
    {
      id: "svc-4",
      name: "Full AI Ecosystem",
      description: "Complete access to all Nick AI services including trading, leads, and identity management.",
      price: 497,
      period: "monthly",
      features: ["All services included", "Priority support", "Custom integrations", "Advanced analytics", "White-label options"],
      roi: "500-1000% ROI",
      popular: true,
    },
  ];

  const subscribers: Subscriber[] = [
    { id: "sub-1", name: "Sarah Johnson", email: "sarah@email.com", service: "AI Trading Signals", joinDate: "2026-01-15", revenue: 485, status: "active" },
    { id: "sub-2", name: "Mike Chen", email: "mike@email.com", service: "Full AI Ecosystem", joinDate: "2026-02-01", revenue: 1491, status: "active" },
    { id: "sub-3", name: "Lisa Rodriguez", email: "lisa@email.com", service: "Lead Generation Pro", joinDate: "2026-01-20", revenue: 788, status: "active" },
    { id: "sub-4", name: "David Wilson", email: "david@email.com", service: "RHNIS Identity Suite", joinDate: "2026-02-10", revenue: 594, status: "paused" },
  ];

  const performance: Performance[] = [
    { service: "AI Trading Signals", subscribers: 45, progress: 75 },
    { service: "Lead Generation Pro", subscribers: 32, progress: 55 },
    { service: "RHNIS Identity Suite", subscribers: 28, progress: 45 },
    { service: "Full AI Ecosystem", subscribers: 22, progress: 35 },
  ];

  const revenueBreakdown: RevenueBreakdown[] = [
    { service: "AI Trading Signals", amount: 4365 },
    { service: "Lead Generation Pro", amount: 6304 },
    { service: "RHNIS Identity Suite", amount: 8316 },
    { service: "Full AI Ecosystem", amount: 10934 },
  ];

  const metrics = {
    monthlyRevenue: 45670.25,
    activeSubscribers: 127,
    monthlyGrowth: 18.5,
    rating: 4.9,
  };

  return jsonResponse({ services, subscribers, performance, revenueBreakdown, metrics });
};
