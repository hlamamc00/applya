// Runs one scan from a terminal: `npm run scan`. Needs .env.
import { runScan } from "../src/lib/jobs/scan";

runScan("MANUAL")
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
