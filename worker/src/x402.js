// x402 v2 "exact" payments on Solana for the paid Case File API (agents pay per check; people use the website free).
// Settlement goes through a facilitator (PayAI by default). We never hold keys: the agent signs a USDC transfer to PAY_TO,
// the facilitator co-signs as fee payer and submits it. The memo binds each payment to one mint, so a receipt can't be reused for another token.

const NETWORKS = {
  mainnet: { id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  devnet: { id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
};

const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const unb64 = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

let feePayerCache = {};
async function feePayer(env, network) {
  if (feePayerCache[network]) return feePayerCache[network];
  const r = await fetch((env.X402_FACILITATOR || "https://facilitator.payai.network") + "/supported");
  const d = await r.json();
  const k = (d.kinds || []).find((x) => x.x402Version === 2 && x.scheme === "exact" && x.network === network);
  if (!k?.extra?.feePayer) throw new Error("facilitator does not support " + network);
  return (feePayerCache[network] = k.extra.feePayer);
}

export async function requirements(env, url, mint) {
  const net = NETWORKS[env.X402_NETWORK || "devnet"];
  return {
    scheme: "exact",
    network: net.id,
    amount: env.X402_PRICE || "10000",           // USDC has 6 decimals: 10000 = $0.01
    asset: net.usdc,
    payTo: env.PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { feePayer: await feePayer(env, net.id), memo: "00trench:" + mint },
  };
}

export function paymentRequired(url, req, error) {
  const body = {
    x402Version: 2,
    error: error || "Payment required: one Ask 00Trench Case File costs $0.01 USDC on Solana. People can use thetrenchforce.com for free.",
    resource: { url, description: "Ask 00Trench Case File: sourced on-chain facts about a Solana token, no verdict", mimeType: "application/json" },
    accepts: [req],
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 402,
    headers: { "content-type": "application/json", "PAYMENT-REQUIRED": b64(body), "access-control-allow-origin": "*",
      "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
  });
}

// Returns { ok: true, settlement } or { ok: false, response }
export async function collect(env, request, url, req) {
  const header = request.headers.get("PAYMENT-SIGNATURE") || request.headers.get("X-PAYMENT");
  if (!header) return { ok: false, response: paymentRequired(url, req) };
  let payload;
  try { payload = unb64(header); } catch { return { ok: false, response: paymentRequired(url, req, "Unreadable PAYMENT-SIGNATURE header") }; }
  const a = payload.accepted || {};
  if (a.network !== req.network || a.asset !== req.asset || a.payTo !== req.payTo || String(a.amount) !== req.amount || a.extra?.memo !== req.extra.memo) {
    return { ok: false, response: paymentRequired(url, req, "Payment does not match these requirements (network, asset, payee, amount, or memo for this mint)") };
  }
  const base = env.X402_FACILITATOR || "https://facilitator.payai.network";
  const call = (path) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req }) }).then((r) => r.json());
  const v = await call("/verify");
  if (!v.isValid) return { ok: false, response: paymentRequired(url, req, "Payment invalid: " + (v.invalidReason || "rejected by facilitator")) };
  const s = await call("/settle");
  if (!s.success) return { ok: false, response: paymentRequired(url, req, "Settlement failed: " + (s.errorReason || "unknown")) };
  return { ok: true, settlement: s, header: b64(s) };
}
