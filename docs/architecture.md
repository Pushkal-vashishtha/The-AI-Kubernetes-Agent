# Architecture

## Overview

The AI Kubernetes Agent is an **on-demand troubleshooting system** — not a
Kubernetes controller/operator. Nothing runs inside the cluster; investigations
happen only when a user asks for one.

```text
Frontend
    ↓
Backend (Orchestrator)
    ↓
Kubernetes Investigation Layer
    ↓
AI Kubernetes Agent
    ↓
LLM Reasoning (OpenRouter via InsForge)
    ↓
Root Cause + Suggested Fix
    ↓
Frontend Diagnosis
```

## Request flow

```text
User clicks "Investigate Cluster"
        ↓
API call
        ↓
Kubernetes investigation
        ↓
AI reasoning
        ↓
Diagnosis shown to user
```

## Backend layers

| Folder            | Responsibility                                          |
| ----------------- | ------------------------------------------------------- |
| `src/api/`        | HTTP routes (Express routers)                           |
| `src/core/`       | Config, logging, shared infrastructure                  |
| `src/kubernetes/` | Cluster inspection (see below)                          |
| `src/ai/`         | LLM reasoning over investigation findings               |
| `src/services/`   | Orchestration: investigation → reasoning → diagnosis    |
| `src/models/`     | Shared data shapes (diagnosis, investigation result)    |

### Kubernetes investigation layer

All cluster access goes through kubectl (no Kubernetes SDK). Components:

| Module                    | Role                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `kubectl.executor.js`     | Safe kubectl runner: no shell, timeouts, structured results      |
| `pod.inspector.js`        | Flags CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled, …  |
| `logs.collector.js`       | Concise failure-focused logs for unhealthy pods (incl. previous run) |
| `events.analyzer.js`      | Summarizes Warning events (FailedScheduling, BackOff, …)         |
| `deployment.inspector.js` | Replica availability, rollout failures, conditions               |
| `network.inspector.js`    | Service selector/endpoint mismatches, cluster DNS health         |

`investigation.service.js` runs them in order — pods → logs → events →
deployments → network — and returns one structured evidence payload.
Every component degrades gracefully when kubectl or the cluster is
unavailable.

### AI reasoning layer

| Module              | Role                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `prompt.builder.js` | Senior-SRE system prompt + evidence sections; strict JSON contract    |
| `llm.client.js`     | OpenRouter via native fetch: 60s timeout, 3 attempts with backoff     |
| `reasoner.js`       | Orchestrates prompt → LLM → validated diagnosis (root cause, fix, kubectl commands, prevention, confidence + reasoning) |

Behavior notes:

- The LLM runs at `temperature: 0` for deterministic output.
- Cluster unreachable → deterministic rule-based diagnosis, no LLM call.
- LLM failure (bad key, timeout) → evidence still returned, `diagnosis: null`
  plus `ai_error`; the API never 500s because of the AI layer.
- The OpenRouter key (from InsForge) is read from the environment and never
  logged or exposed.

## Frontend layers

| Folder            | Responsibility                                          |
| ----------------- | ------------------------------------------------------- |
| `src/components/` | UI components                                           |
| `src/services/`   | API client (axios) and endpoint wrappers                |
| `src/hooks/`      | React Query hooks                                       |
| `src/types/`      | Shared TypeScript types                                 |

## Status

Foundation, the Kubernetes investigation layer, and the AI reasoning layer
(OpenRouter via InsForge key) are implemented. The diagnosis UI,
authentication, and realtime updates are intentionally not implemented yet.
