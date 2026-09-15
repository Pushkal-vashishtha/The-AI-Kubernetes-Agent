// Namespace-scoped collection: for agents installed with a Role in a few
// namespaces instead of a cluster-wide ClusterRole. Cluster-wide list calls
// would be forbidden, so each resource is listed namespace by namespace.

// RFC 1123 label, which is what Kubernetes requires of namespace names.
const NAMESPACE_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Parse "shop, payments" (commas and/or whitespace) into a sorted, unique
 * list. Empty input means cluster-wide and returns null. Throws on a name
 * Kubernetes would reject, so a typo fails loudly at startup.
 */
export function parseNamespaces(raw) {
  if (Array.isArray(raw)) raw = raw.join(",");
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const names = [...new Set(raw.split(/[\s,]+/).filter(Boolean))].sort();
  for (const name of names) {
    if (name.length > 63 || !NAMESPACE_NAME.test(name)) {
      throw new Error(`invalid namespace name: "${name}"`);
    }
  }
  return names.length ? names : null;
}

/**
 * Call `listOne(namespace)` for each namespace and merge the results into the
 * `{ success, data: { items }, error }` shape a cluster-wide list returns.
 * Any failure fails the whole list: silently dropping a namespace we could
 * not read would make a broken app look healthy.
 */
export async function listAcrossNamespaces(namespaces, listOne) {
  const results = await Promise.all(namespaces.map((namespace) => listOne(namespace)));
  const failed = results.find((result) => !result.success);
  if (failed) return { success: false, data: null, error: failed.error };

  return {
    success: true,
    data: { items: results.flatMap((result) => result.data?.items ?? []) },
    error: null,
  };
}
