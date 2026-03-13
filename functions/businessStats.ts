// Sample API for the business dashboard cards and recent leads.
// Replace with real data sources once backend APIs are ready.

type Stat = {
  id: string;
  label: string;
  value: number;
  unit: "usd" | "count";
  changePct: number;
};

type Lead = {
  id: string;
  name: string;
  service: string;
  value: number;
  status: "New" | "Quoted" | "Approved";
};

type WorkerStatus = {
  id: string;
  name: string;
  status: "active" | "idle" | "error";
  lastRun: string;
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
  const payload: {
    stats: Stat[];
    recentLeads: Lead[];
    ncsStatus: WorkerStatus[];
  } = {
    stats: [
      { id: "ecogen_sales", label: "EcoGen Sales", value: 12450, unit: "usd", changePct: 15 },
      { id: "fencing_leads", label: "Fencing Leads", value: 23, unit: "count", changePct: 8 },
      { id: "island_bwoy_orders", label: "Island Bwoy Orders", value: 156, unit: "count", changePct: 22 },
      { id: "total_revenue", label: "Total Revenue", value: 45230, unit: "usd", changePct: 18 },
    ],
    recentLeads: [
      { id: "ld_1", name: "John Smith", service: "Privacy Fence", value: 2500, status: "New" },
      { id: "ld_2", name: "Maria Garcia", service: "Chain Link", value: 1800, status: "Quoted" },
      { id: "ld_3", name: "David Wilson", service: "Vinyl Fence", value: 3200, status: "Approved" },
    ],
    ncsStatus: [
      { id: "shopify", name: "Shopify Worker", status: "active", lastRun: "2026-03-11T15:32:00Z" },
      { id: "lead_generator", name: "Lead Generator", status: "active", lastRun: "2026-03-11T15:30:00Z" },
      { id: "social_bot", name: "Social Media Bot", status: "idle", lastRun: "2026-03-11T12:00:00Z" },
    ],
  };

  return jsonResponse(payload);
};
