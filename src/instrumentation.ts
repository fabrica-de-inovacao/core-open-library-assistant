export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startOrchestratorWorker } = await import('@/server/queue/orchestrator');
    startOrchestratorWorker();
  }
}
