import {
    BaseEdge,
    type Edge,
    EdgeLabelRenderer,
    type EdgeProps,
    getSmoothStepPath,
} from "@xyflow/react";
import type { FlowEdgeData } from "../types";

export function FlowEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
    selected,
}: EdgeProps<Edge<FlowEdgeData>>) {
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 12,
        offset: 24,
    });

    return (
        <>
            <BaseEdge
                id={id}
                path={path}
                markerEnd={markerEnd}
                style={{
                    stroke: data?.stroke,
                    strokeWidth: selected
                        ? 5
                        : data?.pinned
                          ? 4
                          : data?.active
                            ? 3.5
                            : 2,
                    opacity: selected ? 1 : data?.active ? 1 : 0.45,
                    // shared = dashed cyan overlay; delta (primary-only) =
                    // short dash amber cue without merging comparison data.
                    strokeDasharray:
                        data?.inComparison === true
                            ? "4 2"
                            : data?.inComparison === false
                              ? "2 3"
                              : undefined,
                    filter:
                        data?.inComparison === false
                            ? "drop-shadow(0 0 2px #e6a07c88)"
                            : data?.inComparison === true
                              ? "drop-shadow(0 0 2px #66aec488)"
                              : undefined,
                    cursor: "pointer",
                }}
            />
            {data?.label && selected ? (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan"
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            background: "rgba(10, 19, 26, 0.94)",
                            color: data.labelColor,
                            border: `1px solid ${data.labelColor}55`,
                            padding: "3px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1.2,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                            zIndex: 1,
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
}
