// Sample API for LeadBot metrics, campaigns, platforms, and recent leads.

type CampaignStatus = "ACTIVE" | "SCHEDULED" | "COMPLETED";
type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED";

type Campaign = {
  id: string;
  platform: string;
  content: string;
  reach: number;
  leads: number;
  engagement: number;
  status: CampaignStatus;
  scheduledTime?: string;
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  service: string;
  source: string;
  timestamp: string;
  status: LeadStatus;
};

type Platform = {
  name: string;
  status: "connected" | "pending";
  posts: number;
  leads: number;
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
  const payload = {
    overview: {
      totalLeads: 847,
      monthlyLeads: 156,
      conversionRate: 23.5,
      activeCampaigns: 2,
    },
    campaigns: [
      {
        id: "cmp-1",
        platform: "Facebook",
        content: "Professional fence installation - Free estimates! Transform your property with quality fencing.",
        reach: 12500,
        leads: 28,
        engagement: 8.5,
        status: "ACTIVE" as CampaignStatus,
      },
      {
        id: "cmp-2",
        platform: "Instagram",
        content: "Before & After: Amazing fence transformations in your area. See the difference quality makes!",
        reach: 8900,
        leads: 19,
        engagement: 12.3,
        status: "ACTIVE" as CampaignStatus,
      },
      {
        id: "cmp-3",
        platform: "TikTok",
        content: "Quick fence repair tips & when to call the pros. Don't let damaged fences hurt your property value!",
        reach: 15600,
        leads: 34,
        engagement: 15.8,
        status: "SCHEDULED" as CampaignStatus,
        scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
    platforms: [
      { name: "Facebook", status: "connected" as const, posts: 45, leads: 128 },
      { name: "Instagram", status: "connected" as const, posts: 38, leads: 94 },
      { name: "TikTok", status: "connected" as const, posts: 22, leads: 67 },
      { name: "LinkedIn", status: "pending" as const, posts: 0, leads: 0 },
    ],
    recentLeads: [
      {
        id: "lb-1",
        name: "Maria Rodriguez",
        phone: "(555) 123-4567",
        service: "Chain Link Fence",
        source: "Facebook",
        timestamp: new Date().toISOString(),
        status: "NEW" as LeadStatus,
      },
      {
        id: "lb-2",
        name: "John Smith",
        phone: "(555) 987-6543",
        service: "Privacy Fence",
        source: "Instagram",
        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        status: "CONTACTED" as LeadStatus,
      },
      {
        id: "lb-3",
        name: "Lisa Johnson",
        phone: "(555) 456-7890",
        service: "Fence Repair",
        source: "TikTok",
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        status: "QUALIFIED" as LeadStatus,
      },
    ] as Lead[],
  };

  return jsonResponse(payload);
};
