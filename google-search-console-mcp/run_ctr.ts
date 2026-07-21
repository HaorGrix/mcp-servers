import { GoogleSearchConsoleClient } from "./src/client.js";

async function main() {
  const client = new GoogleSearchConsoleClient();
  const candidates = await client.getCTRRescueCandidates("2024-05-01", "2024-07-06", 20, 0.02);
  console.log(JSON.stringify(candidates, null, 2));
}

main().catch(console.error);
