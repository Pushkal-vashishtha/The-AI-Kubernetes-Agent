export interface HealthResponse {
  status: string;
  service: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface Diagnosis {
  root_cause: string;
  explanation: string;
  fix: string;
  kubectl_commands: string[];
  prevention: string;
  confidence: number;
  confidence_reasoning: string;
  source: "llm" | "rule";
  model: string | null;
}

export type StepStatus = "pending" | "running" | "done" | "error";

export interface ProgressStep {
  key: string;
  label: string;
  status: StepStatus;
}

export type InvestigationStatus = "running" | "completed" | "failed";

export type ClusterMode = "local" | "agent";
export type ClusterStatus = "pending" | "online" | "offline";

// One cluster the signed-in user owns, as reported by GET /clusters.
export interface ClusterInfo {
  id: string;
  name: string;
  mode: ClusterMode;
  status: ClusterStatus;
  distro: string | null;
  agent_version: string | null;
  // The agent works but a newer release exists.
  update_available?: boolean;
  last_seen_at: string | null;
  // Backend that registered a local (kubeconfig) cluster; null for agents.
  host: string | null;
  // Whether this backend can investigate the cluster right now.
  available: boolean;
  // Legacy fields kept by the API for older clients.
  context: string;
  cluster: string;
  current: boolean;
}

export interface CreateClusterResponse {
  status: string;
  cluster: ClusterInfo;
  // Shown exactly once -- the backend stores only its hash.
  agent_token: string;
}

export interface ClustersResponse {
  status: string;
  clusters: ClusterInfo[];
  current_context: string | null;
  error: string | null;
}

// Row shape read from InsForge `investigations` (history table)
export interface InvestigationRecord {
  id: string;
  created_at: string;
  status: InvestigationStatus;
  root_cause: string | null;
  namespace: string | null;
  cluster: string | null;
  confidence: number | null;
}

// Realtime payload published by the backend trigger
export interface InvestigationEvent {
  id: string;
  status: InvestigationStatus;
  progress: ProgressStep[];
  root_cause: string | null;
  namespace: string | null;
  cluster: string | null;
  confidence: number | null;
  ai_error: string | null;
  created_at: string;
}

export interface InvestigateResponse {
  status: string;
  investigation_id: string | null;
  cluster: string | null;
  diagnosis: Diagnosis | null;
  ai_error: string | null;
  investigation: {
    cluster_reachable: boolean;
    issues_found: number;
    [key: string]: unknown;
  };
}
