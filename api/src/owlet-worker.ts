import { pool, migrate } from "./db.ts";
import { deliverOwletPushes, downloadOwletLogs, pollDueOwlet } from "./owlet.ts";

await migrate();
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
console.log("Owlet collector ready");
let auxiliary: Promise<void> | undefined;
let nextLogs = 0;
const deliveries = (async () => {
  while (!stopped) {
    const started = Date.now();
    try { await deliverOwletPushes(); }
    catch (error: any) { console.error("Owlet delivery iteration failed", error.code ?? error.name); }
    await new Promise(resolve => setTimeout(resolve, Math.max(50, 500-(Date.now()-started))));
  }
})();
while (!stopped) {
  const started = Date.now();
  try {
    await pollDueOwlet();
    if (!auxiliary) {
      auxiliary = (async () => {
        if (Date.now() >= nextLogs) { nextLogs = Date.now() + 30000; await downloadOwletLogs(); }
      })().catch((error) => console.error("Owlet auxiliary work failed", error.code ?? error.name))
        .finally(() => { auxiliary = undefined; });
    }
  } catch (error: any) {
    console.error("Owlet iteration failed", error.code ?? error.name);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(50,1000-(Date.now()-started))));
}
await auxiliary;
await deliveries;
await pool.end();
