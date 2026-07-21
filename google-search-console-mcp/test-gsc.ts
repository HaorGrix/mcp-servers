import { GoogleSearchConsoleClient } from './src/client.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const gsc = new GoogleSearchConsoleClient();
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const data = await gsc.querySearchAnalytics(startDate, endDate, ['query']);
  console.log(JSON.stringify(data.rows?.slice(0, 5), null, 2));
}
run();
