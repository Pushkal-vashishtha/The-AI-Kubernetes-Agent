// Shape of the evidence payload produced by the investigation service.
// This is the input the AI reasoning layer will consume in a later step.

/**
 * @typedef {Object} ProblematicPod
 * @property {string} name
 * @property {string} namespace
 * @property {string} status   e.g. "CrashLoopBackOff", "ImagePullBackOff", "Pending", "OOMKilled"
 * @property {number} restarts
 * @property {string} message
 */

/**
 * @typedef {Object} PodEvidence
 * @property {boolean | null} healthy   null when the check itself failed
 * @property {number} total_pods
 * @property {ProblematicPod[]} problematic_pods
 * @property {string | null} error
 */

/**
 * @typedef {Object} Investigation
 * @property {string} collected_at
 * @property {number} duration_ms
 * @property {boolean} cluster_reachable
 * @property {number} issues_found
 * @property {PodEvidence} pods
 * @property {Object} logs
 * @property {Object} events
 * @property {Object} deployments
 * @property {Object} network
 */

export {};
