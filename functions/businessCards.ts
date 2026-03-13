// Sample API for business cards grid.

type BusinessCard = {
  id: string;
  name: string;
  description: string;
  image: string;
  status: "Active" | "Growing" | "Paused";
  stats: Record<string, number | string>;
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
  const businesses: BusinessCard[] = [
    {
      id: "biz-ecogen",
      name: "EcoGen Market",
      description: "Global dropshipping store with AI-powered product research",
      image: "https://d64gsuwffb70l.cloudfront.net/68b924f79c49746e335d84b0_1756964139845_b445f52f.webp",
      stats: { revenue: 12450, products: 2340, customers: 890 },
      status: "Active",
    },
    {
      id: "biz-fencing",
      name: "Real Fencing & Home Improvement",
      description: "Professional fencing services with automated lead generation",
      image: "https://d64gsuwffb70l.cloudfront.net/68b924f79c49746e335d84b0_1756964132851_80107075.webp",
      stats: { leads: 23, quoted: 45000, completed: 12 },
      status: "Active",
    },
    {
      id: "biz-island",
      name: "Island Bwoy",
      description: "Caribbean restaurant & natural juice factory",
      image: "https://d64gsuwffb70l.cloudfront.net/68b924f79c49746e335d84b0_1756964137192_06f138ba.webp",
      stats: { orders: 156, revenue: 8920, rating: 4.8 },
      status: "Growing",
    },
  ];

  return jsonResponse({ businesses });
};
