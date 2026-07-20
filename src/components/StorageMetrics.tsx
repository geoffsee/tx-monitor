import { useCallback, useEffect, useState } from "react";

interface StorageMetrics {
    dbPath: string;
    dbSizeBytes: number | null;
    dbSizeFormatted: string;
    packetCount: number | null;
    sessionCount: number | null;
    indexCount: number | null;
    isOptimized: boolean;
    lastOptimizedAt: number | null;
}

interface StorageMetricsProps {
    onOptimize?: () => Promise<void>;
}

export function StorageMetrics({ onOptimize }: StorageMetricsProps) {
    const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [optimizing, setOptimizing] = useState(false);

    const fetchMetrics = useCallback(async () => {
        try {
            const response = await fetch("/api/storage/metrics");
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            setMetrics({
                dbPath: data.dbPath || "~/.tx-monitor",
                dbSizeBytes: data.dbSizeBytes ?? null,
                dbSizeFormatted: formatBytes(data.dbSizeBytes ?? 0),
                packetCount: data.packetCount ?? null,
                sessionCount: data.sessionCount ?? null,
                indexCount: data.indexCount ?? null,
                isOptimized: data.isOptimized ?? false,
                lastOptimizedAt: data.lastOptimizedAt ?? null,
            });
            setError(null);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to load metrics",
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, [fetchMetrics]);

    const handleOptimize = useCallback(async () => {
        if (!onOptimize) {
            try {
                setOptimizing(true);
                const response = await fetch("/api/storage/optimize", {
                    method: "POST",
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                await fetchMetrics(); // Refresh metrics after optimization
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : "Optimization failed",
                );
            } finally {
                setOptimizing(false);
            }
        } else {
            try {
                setOptimizing(true);
                await onOptimize();
                await fetchMetrics();
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : "Optimization failed",
                );
            } finally {
                setOptimizing(false);
            }
        }
    }, [onOptimize, fetchMetrics]);

    if (error) {
        // Only show the component if persistence is enabled
        // If persistence is disabled or there's an error, hide the component
        if (error.includes("Persistence is disabled")) {
            return null;
        }
        return (
            <StorageMetricsContainer>
                <span style={{ color: "#ff6b6b" }}>Storage: {error}</span>
            </StorageMetricsContainer>
        );
    }

    if (!metrics) {
        if (loading) {
            return (
                <StorageMetricsContainer>
                    <span>Loading storage metrics...</span>
                </StorageMetricsContainer>
            );
        }
        return null;
    }

    const needsOptimization = !metrics.isOptimized;

    return (
        <StorageMetricsContainer>
            <span>
                DB: {metrics.dbSizeFormatted} | "
                {metrics.packetCount?.toLocaleString() ?? "?"} pkts | "
                {metrics.sessionCount ?? 0} sessions | "
                {metrics.indexCount ?? 0} indexes
            </span>
            {needsOptimization && (
                <OptimizeButton
                    onClick={handleOptimize}
                    disabled={optimizing}
                    title="Create missing indexes for better query performance"
                >
                    {optimizing ? "Optimizing..." : "⚡ Optimize"}
                </OptimizeButton>
            )}
            {metrics.isOptimized && metrics.lastOptimizedAt && (
                <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    Optimized {formatTimeAgo(metrics.lastOptimizedAt)}
                </span>
            )}
        </StorageMetricsContainer>
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return `${diffDays}d ago`;
    }
    if (diffHours > 0) {
        return `${diffHours}h ago`;
    }
    if (diffMins > 0) {
        return `${diffMins}m ago`;
    }
    return "just now";
}

const StorageMetricsContainer = ({
    children,
}: {
    children: React.ReactNode;
}) => (
    <div
        style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 12px",
            background: "rgba(10, 20, 28, 0.9)",
            border: "1px solid rgba(137, 189, 224, 0.3)",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
            color: "#d9e6ec",
            backdropFilter: "blur(10px)",
            zIndex: 1000,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        }}
    >
        {children}
    </div>
);

const OptimizeButton = ({
    children,
    onClick,
    disabled,
    title,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
    title: string;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        style={{
            padding: "4px 8px",
            background: disabled ? "#3a4a58" : "#1e3a8a",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 11,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
            transition: "background 0.2s",
        }}
        onMouseEnter={(e) => {
            if (!disabled) {
                e.currentTarget.style.background = "#2563eb";
            }
        }}
        onMouseLeave={(e) => {
            if (!disabled) {
                e.currentTarget.style.background = "#1e3a8a";
            }
        }}
    >
        {children}
    </button>
);
