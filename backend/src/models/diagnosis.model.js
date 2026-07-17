// Shape of the diagnosis produced by the AI reasoning layer.

/**
 * @typedef {Object} Diagnosis
 * @property {string} root_cause            One-sentence root cause
 * @property {string} explanation           How the evidence supports the conclusion
 * @property {string} fix                   Step-by-step practical fix
 * @property {string[]} kubectl_commands    Exact commands using real resource names
 * @property {string} prevention            How to avoid this class of incident
 * @property {number} confidence            0-100
 * @property {string} confidence_reasoning  Why this confidence level
 * @property {"llm" | "rule"} source        "rule" = deterministic (e.g. cluster unreachable)
 * @property {string | null} model          Model id that produced the diagnosis (null for "rule")
 */

export {};
