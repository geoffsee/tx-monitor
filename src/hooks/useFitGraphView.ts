import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import type { FlowEdgeData, HostNodeData } from "../types";

type TrafficFlowInstance = ReactFlowInstance<
    Node<HostNodeData>,
    Edge<FlowEdgeData>
>;

export function useFitGraphView(
    flowRef: React.RefObject<TrafficFlowInstance | null>,
) {
    const lastFitBucket = useRef(-1);

    const fitGraphView = useCallback(
        (hostCount: number) => {
            if (!flowRef.current || hostCount === 0) {
                return;
            }

            const fitBucket = Math.ceil(hostCount / 4);
            if (fitBucket === lastFitBucket.current) {
                return;
            }

            lastFitBucket.current = fitBucket;
            requestAnimationFrame(() => {
                flowRef.current?.fitView({
                    padding: 0.1,
                    minZoom: 0.55,
                    maxZoom: 1,
                    duration: 240,
                    includeHiddenNodes: false,
                });
            });
        },
        [flowRef],
    );

    return fitGraphView;
}

export function useFitGraphOnHostCount(
    flowRef: React.RefObject<TrafficFlowInstance | null>,
    hostCount: number,
) {
    const fitGraphView = useFitGraphView(flowRef);

    useEffect(() => {
        fitGraphView(hostCount);
    }, [hostCount, fitGraphView]);

    return fitGraphView;
}
