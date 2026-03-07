// Cloudflare Pages Function: handle contact form submissions.
// Accepts POST requests with a JSON body containing name, email, and message.
// For now, the payload is logged and an acknowledgement is returned.

type ContactPayload = {
  name: string;
  email: string;
  message: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  // Respond to preflight requests so browsers can send JSON safely.
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost = async ({ request }: { request: Request }) => {
  let payload: Partial<ContactPayload>;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { name, email, message } = payload;

  if (!name || !email || !message) {
    return jsonResponse(
      { ok: false, error: "Missing name, email, or message" },
      400
    );
  }

  // Log for now; replace with email, CRM, or ticketing integration later.
  console.log("Contact submission received", { name, email, message });

  return jsonResponse({
    ok: true,
    message: "Thanks for reaching out. We'll get back to you shortly.",
  });
};
