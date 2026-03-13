// Sample API for the lead management dashboard panel.
// Replace with CRM/DB lookups when backend is ready.

type LeadStatus = "New" | "Contacted" | "Quoted" | "Approved" | "Completed";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  service: string;
  location: string;
  value: number;
  status: LeadStatus;
  date: string; // ISO string
  notes: string;
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
  const leads: Lead[] = [
    {
      id: "ld-1001",
      name: "John Smith",
      email: "john@email.com",
      phone: "(555) 123-4567",
      service: "Privacy Fence",
      location: "Miami, FL",
      value: 2500,
      status: "New",
      date: "2026-03-10T15:00:00Z",
      notes: "Needs 150ft privacy fence, cedar preferred",
    },
    {
      id: "ld-1002",
      name: "Maria Garcia",
      email: "maria@email.com",
      phone: "(555) 987-6543",
      service: "Chain Link",
      location: "Orlando, FL",
      value: 1800,
      status: "Quoted",
      date: "2026-03-09T18:30:00Z",
      notes: "Commercial property, 200ft chain link",
    },
    {
      id: "ld-1003",
      name: "David Wilson",
      email: "david@email.com",
      phone: "(555) 456-7890",
      service: "Vinyl Fence",
      location: "Tampa, FL",
      value: 3200,
      status: "Approved",
      date: "2026-03-08T13:15:00Z",
      notes: "White vinyl, 180ft with gates",
    },
  ];

  return jsonResponse({ leads });
};
