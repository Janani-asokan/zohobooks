import { createApp } from './app';
import { config } from './config';
import { startJobs } from './jobs';
import { migrate } from './migrate';

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`[server] Ledgerly API listening on :${config.port} (${config.env})`));
  startJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
