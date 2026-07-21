import { GoogleAnalyticsClient } from './src/client.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const ga = new GoogleAnalyticsClient();
  const data = await ga.runReport({
    startDate: '7daysAgo',
    endDate: 'today',
    dimensions: [{name: 'date'}],
    metrics: [{name: 'activeUsers'}, {name: 'screenPageViews'}],
  });
  console.log(JSON.stringify(data.rows?.slice(0, 5), null, 2));
}
run();
