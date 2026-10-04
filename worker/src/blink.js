// Solana Actions / Blinks for Ask 00Trench.
//   thetrenchforce.com/check/<MINT>      share link: humans get a page that opens the checker; Blink clients get the Action below
//   /actions.json                        maps /check/* → /api/actions/casefile/*
//   GET  /api/actions/casefile/<MINT>    Action: the Case File's key facts + "Stamp this Case File on Solana"
//   POST /api/actions/casefile/<MINT>    returns a memo-only transaction the user signs: "00trench:casefile@1:<mint>:<sha256 of the facts>"
// The stamp is a public, timestamped proof of what the facts were. No funds move; the signer pays only the network fee.
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildCaseFile } from "./casefile.js";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const ICON = "https://thetrenchforce.com/assets/avatar-still.jpg";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
  "x-action-version": "2.4",
  "x-blockchain-ids": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};
const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
const isMint = (m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);
const v = (cf, k) => cf.fields.find((f) => f.key === k)?.value;

function summary(cf) {
  const lines = [
    `Insider wallets: ${v(cf, "insider_wallets") ?? "unknown"} (holding ${v(cf, "insider_networks_pct") ?? "?"}% of supply)`,
    `Creator wallet age: ${v(cf, "creator_wallet_age") ?? "unknown"} · recent launches: ${v(cf, "creator_recent_launches") ?? "unknown"}`,
    `Creator holds: ${v(cf, "creator_holds_pct") ?? "?"}% · top 10: ${v(cf, "top10_pct") ?? "?"}%`,
    `Mint authority: ${v(cf, "mint_authority") ?? "unknown"} · freeze: ${v(cf, "freeze_authority") ?? "unknown"}`,
    `Metadata tries to instruct AI agents: ${v(cf, "metadata_injection") ?? "unknown"}`,
    "Facts with sources, no verdict. Not financial advice.",
  ];
  return lines.join("\n");
}

async function digest(cf) {
  const facts = JSON.stringify(cf.fields.map((f) => [f.key, f.value]));
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cf.mint + "|" + facts));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function actionsJson() {
  return out({ rules: [{ pathPattern: "/check/*", apiPath: "/api/actions/casefile/*" }] });
}

export async function action(request, env, mint) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!isMint(mint)) return out({ message: "Not a Solana mint address" }, 400);
  const cf = await buildCaseFile(env, mint);
  const sym = cf.token_metadata_untrusted?.symbol || mint.slice(0, 4) + "…" + mint.slice(-4);
  if (request.method === "GET") {
    if (env.AGENT_KV) { try { const k = `use:${new Date().toISOString().slice(0, 10)}:blink`; await env.AGENT_KV.put(k, String(parseInt((await env.AGENT_KV.get(k)) || "0", 10) + 1), { expirationTtl: 31536000 }); } catch {} }
    return out({
      type: "action", icon: ICON, title: `Ask 00Trench Case File: ${sym}`.slice(0, 80),
      description: summary(cf), label: "Stamp on Solana",
      links: { actions: [{ type: "transaction", label: "Stamp this Case File on Solana", href: `/api/actions/casefile/${mint}` }] },
    });
  }
  if (request.method !== "POST") return out({ message: "GET or POST" }, 405);
  let account;
  try { account = new PublicKey((await request.json()).account); } catch { return out({ message: "Invalid account" }, 400); }
  const hash = await digest(cf);
  const memo = `00trench:casefile@1:${mint}:${hash}`;
  const conn = new Connection(env.SOLANA_RPC || "https://solana-rpc.publicnode.com", "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: account, blockhash, lastValidBlockHeight })
    .add(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: account, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) }));
  return out({
    type: "transaction",
    transaction: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
    message: "Stamps a fingerprint of this Case File on Solana. No funds move; you pay only the network fee.",
    links: { next: { type: "inline", action: { type: "completed", icon: ICON, title: `Case File stamped: ${sym}`.slice(0, 80),
      description: `Fingerprint ${hash.slice(0, 16)}… is now on Solana with your signature and a timestamp. Anyone can recompute it from the Case File.`,
      label: "Stamped" } } },
  });
}

// Share page for humans: OG tags with the facts (nice X/iMessage previews even without a Blink client), then opens the checker with the mint.
export async function sharePage(env, mint) {
  if (!isMint(mint)) return new Response("Not a Solana mint address", { status: 400 });
  let desc = "Sourced on-chain facts, no verdict. Free at thetrenchforce.com";
  let sym = mint.slice(0, 4) + "…" + mint.slice(-4);
  try { const cf = await buildCaseFile(env, mint); desc = summary(cf).split("\n").slice(0, 3).join(" · "); sym = cf.token_metadata_untrusted?.symbol || sym; } catch {}
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const title = esc(`Ask 00Trench Case File: ${sym}`);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://thetrenchforce.com/assets/og.jpg"><meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="https://thetrenchforce.com/assets/og.jpg">
<meta http-equiv="refresh" content="0; url=/?mint=${mint}#ask"></head>
<body style="background:#000;color:#eee;font-family:sans-serif"><p><a href="/?mint=${mint}#ask" style="color:#FFD400">Open the Case File for ${esc(sym)}</a></p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
}
