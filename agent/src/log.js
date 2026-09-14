// Plain line logs to stdout -- `kubectl logs` is the agent's only UI.
const stamp = () => new Date().toISOString();

export default {
  info: (message) => console.log(`[${stamp()}] INFO  ${message}`),
  warn: (message) => console.log(`[${stamp()}] WARN  ${message}`),
  error: (message) => console.error(`[${stamp()}] ERROR ${message}`),
};
