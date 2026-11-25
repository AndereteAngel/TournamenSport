import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getKey(name: string, dictionaryName: string): string | null {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const dictionary = Deno.env.get(dictionaryName);
  if (!dictionary) return null;
  try {
    const parsed = JSON.parse(dictionary);
    return parsed.default || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = getKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = getKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  if (!accessToken || !supabaseUrl || !publishableKey || !serviceKey) {
    return json({ error: "La integración de pagos todavía no está configurada en el servidor." }, 503);
  }

  const authorization = req.headers.get("Authorization") || "";
  const jwt = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sesión no válida. Volvé a ingresar." }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !userData.user) return json({ error: "No se pudo validar tu sesión." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { charge_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  const chargeIds = body.charge_ids;
  if (!Array.isArray(chargeIds) || chargeIds.length < 1 || chargeIds.length > 50
      || !chargeIds.every((id) => typeof id === "string")) {
    return json({ error: "Seleccioná entre 1 y 50 fichajes pendientes." }, 400);
  }

  const { data: paymentData, error: paymentError } = await admin.rpc("begin_fefutin_payment", {
    p_user_id: userData.user.id,
    p_charge_ids: chargeIds,
  });
  if (paymentError || !paymentData?.payment_id) {
    return json({ error: paymentError?.message || "No se pudo preparar el pago." }, 400);
  }

  const amount = Number(paymentData.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    await admin.from("fefutin_payments").update({
      status: "rejected",
      provider_status: "invalid_local_amount",
    }).eq("id", paymentData.payment_id);
    return json({ error: "El importe del pago no es válido." }, 400);
  }

  const orderBody = {
    type: "online",
    processing_mode: "manual",
    capture_mode: "automatic_async",
    total_amount: amount.toFixed(2),
    external_reference: paymentData.external_reference,
    description: "Fichajes de jugadores FEFUTIN",
    expiration_time: "P1D",
    payer: { email: userData.user.email },
    items: paymentData.items,
  };

  const mpResponse = await fetch("https://api.mercadopago.com/v1/orders", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Idempotency-Key": paymentData.idempotency_key,
    },
    body: JSON.stringify(orderBody),
  });

  const mpOrder = await mpResponse.json().catch(() => ({}));
  if (!mpResponse.ok || !mpOrder.id || !mpOrder.checkout_url) {
    const detail = String(mpOrder.message || mpOrder.error || "No se pudo crear la orden en Mercado Pago").slice(0, 500);
    await admin.from("fefutin_payments").update({
      status: "rejected",
      provider_status: "order_creation_failed",
      provider_status_detail: detail,
      metadata: { flow: "player_fichaje", mp_error_status: mpResponse.status },
      updated_at: new Date().toISOString(),
    }).eq("id", paymentData.payment_id);
    return json({ error: "Mercado Pago no pudo iniciar el pago. Podés volver a intentarlo." }, 502);
  }

  const { error: saveError } = await admin.from("fefutin_payments").update({
    provider_order_id: String(mpOrder.id),
    checkout_url: String(mpOrder.checkout_url),
    provider_status: String(mpOrder.status || "created"),
    provider_status_detail: String(mpOrder.status_detail || "created"),
    metadata: { flow: "player_fichaje", order_api: "v1/orders" },
    updated_at: new Date().toISOString(),
  }).eq("id", paymentData.payment_id);

  if (saveError) {
    // Do not expose an untracked checkout URL if the order could not be persisted.
    return json({ error: "La orden se creó, pero no pudimos registrarla. Contactá a administración antes de volver a pagar." }, 500);
  }

  return json({
    payment_id: paymentData.payment_id,
    checkout_url: mpOrder.checkout_url,
    amount: paymentData.amount,
    currency: "ARS",
  });
});
