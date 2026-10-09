export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_SCHEDULER === "true") return;
  const { startScheduler } = await import("./src/server/scheduler");
  startScheduler();
}
