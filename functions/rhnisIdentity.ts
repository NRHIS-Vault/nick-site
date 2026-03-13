// Sample API for RHNIS (Right Hand Nick Identity System) panel.

type IdentityFeature = {
  title: string;
  status: string;
  description: string;
  icon: "fingerprint" | "eye" | "radio" | "shield";
};

type BeaconDatum = {
  type: string;
  count: number;
  status: string;
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
    identityFeatures: [
      { icon: "fingerprint" as const, title: "Voice Signature", status: "Active", description: "Unique voice pattern recognition" },
      { icon: "eye" as const, title: "Face Recognition", status: "Active", description: "Facial identity verification" },
      { icon: "radio" as const, title: "Digital Beacon", status: "Broadcasting", description: "Traceable digital footprint" },
      { icon: "shield" as const, title: "Sting Mode", status: "Armed", description: "Scammer detection & trapping" },
    ] as IdentityFeature[],
    beaconData: [
      { type: "Social Media", count: 1247, status: "Propagating" },
      { type: "Comments", count: 892, status: "Active" },
      { type: "Posts", count: 156, status: "Spreading" },
      { type: "Interactions", count: 3421, status: "Tracking" },
    ] as BeaconDatum[],
    legacyStats: {
      voiceRecordingsMb: 2300,
      interactionLogsMb: 456,
      digitalSignaturesMb: 12,
    },
    beaconSignature: `RHNIS-${Date.now().toString(36).toUpperCase()}`,
  };

  return jsonResponse(payload);
};
