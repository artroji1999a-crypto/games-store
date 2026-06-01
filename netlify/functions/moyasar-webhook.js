const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

async function verifyPayment(paymentId) {
  const auth = Buffer.from(MOYASAR_SECRET_KEY + ":").toString("base64");
  const res = await fetch(`https://api.moyasar.com/v1/payments/${paymentId}`, {
    headers: { "Authorization": "Basic " + auth }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Could not verify Moyasar payment");
  return data;
}

async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}

async function getGameId() {
  const rows = await supabase("/games?slug=eq.khmnha&select=id&limit=1");
  if (!rows || !rows.length) throw new Error("Game not found");
  return rows[0].id;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MOYASAR_SECRET_KEY) {
      return json(500, { ok: false, message: "Missing environment variables" });
    }

    let paymentId = null;
    if (event.httpMethod === "GET") {
      paymentId = event.queryStringParameters && event.queryStringParameters.id;
    } else {
      const body = JSON.parse(event.body || "{}");
      paymentId = body.id || body.payment_id || (body.data && body.data.id);
    }

    if (!paymentId) return json(400, { ok: false, message: "Missing payment id" });

    const payment = await verifyPayment(paymentId);
    if (payment.status !== "paid") {
      return json(200, { ok: false, status: payment.status, message: "الدفع لم يكتمل بعد." });
    }

    const userId = payment.metadata && payment.metadata.user_id;
    const game = payment.metadata && payment.metadata.game;
    if (!userId || game !== "khmnha") {
      return json(400, { ok: false, message: "بيانات الدفع ناقصة." });
    }

    const gameId = await getGameId();
    const payload = {
      user_id: userId,
      game_id: gameId,
      status: "paid",
      payment_provider: "moyasar",
      payment_id: payment.id
    };

    await supabase("/purchases?on_conflict=user_id,game_id", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload)
    });

    return json(200, { ok: true, message: "تم تفعيل اللعبة.", payment_id: payment.id });
  } catch (err) {
    return json(500, { ok: false, message: "Webhook error: " + err.message });
  }
};