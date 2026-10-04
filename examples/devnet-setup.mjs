// Devnet only: create a throwaway agent wallet and fund it with free devnet SOL. No real money.
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
const f = ".agent-wallet-devnet.json";
const kp = fs.existsSync(f) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f)))) : Keypair.generate();
fs.writeFileSync(f, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
console.log("agent wallet (devnet):", kp.publicKey.toBase58());
const c = new Connection("https://api.devnet.solana.com", "confirmed");
try { const sig = await c.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL); await c.confirmTransaction(sig); } catch (e) { console.log("airdrop:", e.message.slice(0, 120)); }
console.log("SOL balance:", (await c.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL);
