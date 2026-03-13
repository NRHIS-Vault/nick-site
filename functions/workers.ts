// Sample API for worker/automation status used by the NCS panel.

type WorkerStatus = "running" | "stopped" | "error" | "idle";
type WorkerType = "automation" | "monitoring" | "processing";

type Worker = {
  id: string;
  name: string;
  type: WorkerType;
  status: WorkerStatus;
  lastRun: string;
  nextRun?: string;
  description: string;
  metrics: {
    tasksCompleted: number;
    successRate: number;
    avgRunTimeSeconds: number;
  };
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
  const workers: Worker[] = [
    {
      id: "wrk-1",
      name: "Shopify Product Sync",
      type: "automation",
      status: "running",
      lastRun: "2026-03-12T14:30:00Z",
      nextRun: "2026-03-12T15:30:00Z",
      description: "Syncs products, inventory, and orders with EcoGen Market",
      metrics: { tasksCompleted: 1247, successRate: 98.5, avgRunTimeSeconds: 2.3 },
    },
    {
      id: "wrk-2",
      name: "Lead Generator",
      type: "automation",
      status: "running",
      lastRun: "2026-03-12T14:25:00Z",
      nextRun: "2026-03-12T14:35:00Z",
      description: "Processes fencing leads and sends auto-responses",
      metrics: { tasksCompleted: 89, successRate: 100, avgRunTimeSeconds: 1.8 },
    },
    {
      id: "wrk-3",
      name: "Social Media Bot",
      type: "automation",
      status: "idle",
      lastRun: "2026-03-12T12:00:00Z",
      nextRun: "2026-03-12T18:00:00Z",
      description: "Posts content and engages on social platforms",
      metrics: { tasksCompleted: 45, successRate: 95.6, avgRunTimeSeconds: 5.2 },
    },
    {
      id: "wrk-4",
      name: "System Monitor",
      type: "monitoring",
      status: "running",
      lastRun: "2026-03-12T14:32:00Z",
      nextRun: "2026-03-12T14:33:00Z",
      description: "Monitors system health and performance",
      metrics: { tasksCompleted: 8640, successRate: 99.9, avgRunTimeSeconds: 0.5 },
    },
    {
      id: "wrk-5",
      name: "Data Processor",
      type: "processing",
      status: "error",
      lastRun: "2026-03-12T14:20:00Z",
      description: "Processes and analyzes business data",
      metrics: { tasksCompleted: 234, successRate: 87.2, avgRunTimeSeconds: 12.1 },
    },
  ];

  const summary = {
    systemHealthPct: 98.5,
    activeWorkers: 3,
    totalWorkers: workers.length,
    uptimePct: 99.9,
    errors: 1,
  };

  return jsonResponse({ summary, workers });
};
