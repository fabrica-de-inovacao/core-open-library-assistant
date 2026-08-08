import { startOrchestratorWorker } from './orchestrator';

const worker = startOrchestratorWorker();

process.on('SIGTERM', () => void worker.close());
process.on('SIGINT', () => void worker.close());
