import { GoogleSearchConsoleClient } from "./src/client.js";

async function main() {
  const client = new GoogleSearchConsoleClient();
  await client.submitSitemap("https://haorgrix.com/sitemap.xml");
  console.log("Sitemap submitted successfully.");
}

main().catch(console.error);
