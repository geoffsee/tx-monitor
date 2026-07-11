import { trafficNetwork } from "./trafficNetwork";

/** Host-like fields needed for public/DNS vs label fallback. */
export type HostLabelSource =
    | {
          category?: string;
          label?: string;
      }
    | null
    | undefined;

/**
 * Resolve a display label for an address: public hosts prefer resolved DNS,
 * else host.label, else the raw address.
 */
export function resolveDisplayHostLabel(
    address: string,
    host: HostLabelSource,
    dns: string | undefined,
): string {
    if (host?.category === "public" && dns) {
        return dns;
    }
    return host?.label ?? address;
}

/**
 * Live lookup via trafficNetwork (full host set, not graph.nodes capped at
 * MAX_GRAPH_HOSTS). Use in UI lists/panels that may reference hosts outside
 * the laid-out graph.
 */
export function displayHostLabel(address: string): string {
    return resolveDisplayHostLabel(
        address,
        trafficNetwork.hosts.get(address),
        trafficNetwork.resolvedDns.get(address),
    );
}
