import { GoogleSearchConsoleClient } from "./src/client.js";

async function main() {
  const client = new GoogleSearchConsoleClient();
  const sitemaps = await client.listSitemaps();
  console.log(JSON.stringify(sitemaps, null, 2));
}

main().catch(console.error);
