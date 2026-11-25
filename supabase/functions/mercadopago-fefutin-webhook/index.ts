import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validateSignature(signature: string, requestId: string, dataId: string, secret: string) {
  const parts = Object.fromEntries(signature.split(",").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const ts = parts.ts;
  const receivedHash = parts.v1;
  if (!ts || !receivedHash || !requestId || !dataId) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  const expectedHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expectedHash, receivedHash.toLowerCase());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || (() => {
      try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || null; }
      catch { return null; }
    })();

  if (!webhookSecret || !accessToken || !supabaseUrl || !serviceKey) {
    return json({ error: "Webhook no configurado" }, 503);
  }

  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") || "";
  const xSignature = req.headers.get("x-signature") || "";
  const xRequestId = req.headers.get("x-request-id") || "";
  if (!await validateSignature(xSignature, xRequestId, dataId, webhookSecret)) {
    return json({ error: "Firma de notificación inválida" }, 401);
  }

  let notification: Record<string, unknown> = {};
  try { notification = await req.json(); } catch { /* Query params are authoritative for resource lookup. */ }
  if (notification.type && notification.type !== "order") return json({ received: true, ignored: true });
  if (!dataId) return json({ error: "Falta el identificador de la orden" }, 400);

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  const order = await mpResponse.json().catch(() => ({}));
  if (!mpResponse.ok || !order.id) {
    return json({ error: "No se pudo verificar la orden con Mercado Pago" }, 502);
  }

  const transactionPayments = order.transactions?.payments || [];
  const paymentId = transactionPayments.find((item: Record<string, unknown>) => item.id)?.id;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: result, error } = await admin.rpc("apply_fefutin_payment_order_update", {
    p_order_id: String(order.id),
    p_external_reference: String(order.external_reference || ""),
    p_order_status: String(order.status || ""),
    p_status_detail: String(order.status_detail || ""),
    p_order_total_amount: Number(order.total_amount || 0),
    p_total_paid_amount: Number(order.total_paid_amount || 0),
    p_currency: order.currency || order.currency_id || null,
    p_provider_payment_id: paymentId ? String(paymentId) : null,
  });

  if (error) return json({ error: "No se pudo aplicar la actualización del pago." }, 500);
  return json({ received: true, result });
});
