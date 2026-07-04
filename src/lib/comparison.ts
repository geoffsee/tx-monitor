const MAX_COMPARISON_ENTRIES = 2000;

let comparisonSessionId: string | null = null;
let comparisonLabel: string | null = null;
let comparisonHosts = new Set<string>();
let comparisonFlows = new Set<string>();

export type ComparisonContext = {
    sessionId: string;
    label: string;
    hostIds: Set<string>;
    flowIds: Set<string>;
};

export function setComparisonContext(
    sessionId: string,
    label: string,
    hostIds: Iterable<string>,
    flowIds: Iterable<string>,
): void {
    comparisonSessionId = sessionId;
    comparisonLabel = label || sessionId;

    const hostSet = new Set<string>();
    for (const h of hostIds) {
        if (hostSet.size >= MAX_COMPARISON_ENTRIES) break;
        if (h) hostSet.add(h);
    }
    comparisonHosts = hostSet;

    const flowSet = new Set<string>();
    for (const f of flowIds) {
        if (flowSet.size >= MAX_COMPARISON_ENTRIES) break;
        if (f) flowSet.add(f);
    }
    comparisonFlows = flowSet;
}

export function clearComparisonContext(): void {
    comparisonSessionId = null;
    comparisonLabel = null;
    comparisonHosts = new Set<string>();
    comparisonFlows = new Set<string>();
}

export function getComparisonContext(): ComparisonContext | null {
    if (!comparisonSessionId) {
        return null;
    }
    return {
        sessionId: comparisonSessionId,
        label: comparisonLabel ?? comparisonSessionId,
        hostIds: comparisonHosts,
        flowIds: comparisonFlows,
    };
}

export function isHostInComparison(hostId: string): boolean {
    if (!hostId) return false;
    return comparisonHosts.has(hostId);
}

export function isFlowInComparison(flowId: string): boolean {
    if (!flowId) return false;
    return comparisonFlows.has(flowId);
}

export function getComparisonHostCount(): number {
    return comparisonHosts.size;
}

export function getComparisonFlowCount(): number {
    return comparisonFlows.size;
}
