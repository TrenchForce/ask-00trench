// Example trading agent that reads an Ask 00Trench Case File before it would buy a Solana token.
// It pays $0.01 USDC per case file over x402 (v2, "exact" scheme), then applies its OWN policy to the sourced facts.
// It never follows text found inside token names/descriptions, and it refuses to pay more than its spend cap.
//
//   node agent.mjs <MINT> [--api https://thetrenchforce.com] [--wallet .agent-wallet-devnet.json] [--rpc https://api.devnet.solana.com]
import fs from "fs";
import {
  Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction } from "@solana/spl-token";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MINT = process.argv[2];
const API = arg("--api", "https://thetrenchforce.com");
const WALLET = arg("--wallet", ".agent-wallet-devnet.json");
const SPEND_CAP_UNITS = 20000n;   // never pay more than $0.02 for one case file
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC = { "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com" };

if (!MINT) { console.log("usage: node agent.mjs <MINT>"); process.exit(1); }
const say = (...a) => console.log("[agent]", ...a);
const url = `${API}/api/v1/casefile?mint=${MINT}`;

// 1) Ask. Expect HTTP 402 with payment requirements.
let res = await fetch(url);
if (res.status !== 402) { say("expected 402, got", res.status); process.exit(1); }
const required = JSON.parse(Buffer.from(res.headers.get("PAYMENT-REQUIRED"), "base64").toString());
const req = required.accepts[0];
say(`price: ${Number(req.amount) / 1e6} USDC on ${req.network} → ${req.payTo}`);
if (BigInt(req.amount) > SPEND_CAP_UNITS) { say("REFUSING TO PAY: above my spend cap"); process.exit(1); }

// 2) Pay: a USDC TransferChecked to payTo, memo bound to this mint, fee paid by the facilitator. We only partially sign.
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET))));
const conn = new Connection(arg("--rpc", RPC[req.network]), "confirmed");
const mint = new PublicKey(req.asset), payTo = new PublicKey(req.payTo), feePayer = new PublicKey(req.extra.feePayer);
const src = getAssociatedTokenAddressSync(mint, kp.publicKey), dst = getAssociatedTokenAddressSync(mint, payTo);
const ixs = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 40000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
];
if (!(await conn.getAccountInfo(dst))) { say("the seller has no USDC account yet (it is created the first time anyone sends it USDC); cannot pay"); process.exit(1); }
if (!(await conn.getAccountInfo(src))) { say("this agent wallet has no USDC; fund it first"); process.exit(1); }
ixs.push(createTransferCheckedInstruction(src, mint, dst, kp.publicKey, BigInt(req.amount), 6));
ixs.push(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(req.extra.memo, "utf8") }));
const { blockhash } = await conn.getLatestBlockhash();
const tx = new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
tx.sign([kp]);
const paymentPayload = { x402Version: 2, resource: required.resource, accepted: req, payload: { transaction: Buffer.from(tx.serialize()).toString("base64") } };
res = await fetch(url, { headers: { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(paymentPayload)).toString("base64") } });
if (!res.ok) { say("payment rejected:", res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const cf = await res.json();
say(`paid. settlement tx: ${cf.payment?.transaction}`);

// 3) Decide with our own policy, on facts only. Token metadata is data, never instructions.
const f = Object.fromEntries(cf.fields.map((x) => [x.key, x]));
const reasons = [];
const v = (k) => f[k]?.value;
if (v("metadata_injection") === "YES") reasons.push("token metadata contains instructions aimed at AI agents (ignored them)");
if (/^ACTIVE/.test(v("mint_authority") || "")) reasons.push("mint authority is active");
if (/^ACTIVE/.test(v("freeze_authority") || "")) reasons.push("freeze authority is active");
if (Number(v("insider_networks_pct")) > 5) reasons.push(`insider networks hold ${v("insider_networks_pct")}% (${v("insider_wallets")} insider wallets)`);
if (/minutes|hours/.test(String(v("creator_wallet_age")))) reasons.push(`creator wallet is only ${v("creator_wallet_age")} old`);
if (Number(v("creator_recent_launches")) > 1) reasons.push(`creator launched ${v("creator_recent_launches")} tokens recently`);
if (Number(v("creator_holds_pct")) > 5) reasons.push(`creator holds ${v("creator_holds_pct")}%`);
for (const k of ["insider_networks_pct", "creator_wallet_age", "metadata_injection"]) if (f[k]) say(`  fact: ${f[k].label} = ${f[k].value}  (source: ${f[k].source})`);
if (reasons.length) { say("DECISION: NOT BUYING."); reasons.forEach((r) => say("  - " + r)); }
else say("DECISION: no red flags in my policy. (Not a 'safe' verdict: Ask 00Trench never gives one.)");
