import type React from "react";

export const nodeMetricStyle: React.CSSProperties = {
    padding: 8,
    borderRadius: 8,
    background: "#101d26",
    border: "1px solid #1a2c38",
};

export const nodeMetricLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

export const nodeMetricValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 16,
    fontWeight: 700,
};

export const scanlineStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
        "linear-gradient(rgba(98, 132, 149, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(98, 132, 149, 0.04) 1px, transparent 1px)",
    backgroundSize: "24px 24px",
};

export const overlayPanelStyle: React.CSSProperties = {
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.22)",
};

export const eyebrowStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#66aec4",
};

export const compactKpiStyle: React.CSSProperties = {
    minWidth: 78,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0d1821",
    display: "grid",
    gap: 2,
};

export const compactKpiLabelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

export const compactKpiValueStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
};

export const legendPanelStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
};

export const legendRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
};

export const legendSwatchStyle: React.CSSProperties = {
    width: 12,
    height: 3,
    display: "inline-block",
    borderRadius: 999,
};

export const tickerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
    color: "#b8cbd5",
};

export const tickerLabelStyle: React.CSSProperties = {
    color: "#66aec4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
};

export const sidePanelStyle: React.CSSProperties = {
    borderRadius: 12,
    padding: 12,
    border: "1px solid #1a2d3a",
    background: "#0b141b",
    boxSizing: "border-box",
};

export const summaryCardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
};

export const summaryLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

export const summaryValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontWeight: 700,
    color: "#d9e6ec",
    fontSize: 14,
};

export const panelTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#66aec4",
};

export const statusBadgeStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${active ? "#1f4d40" : "#33414a"}`,
    background: active ? "rgba(41, 161, 116, 0.12)" : "rgba(70, 90, 102, 0.12)",
    color: active ? "#7ce3b7" : "#9aa8b2",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
});

export const listStyle: React.CSSProperties = {
    margin: "12px 0 0",
    padding: 0,
    listStyle: "none",
    display: "grid",
    gap: 8,
};

export const denseStatusRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    minWidth: 0,
};

export const denseSubtleStyle: React.CSSProperties = {
    marginTop: 2,
    fontSize: 11,
    color: "#7f99a7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

export const denseListRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    lineHeight: 1.35,
};

export const denseFeedRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderLeft: "2px solid #1f4d40",
    background: "#0f1921",
    color: "#d9e6ec",
    lineHeight: 1.35,
    fontSize: 12,
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

export const selectedRowStyle: React.CSSProperties = {
    borderColor: "#66aec4",
    background: "#132028",
    boxShadow: "inset 0 0 0 1px #66aec433",
};

export const detailPanelStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 10,
    border: "1px solid #223849",
    background: "#0d1821",
    display: "grid",
    gap: 10,
    minWidth: 0,
    maxHeight: 240,
    overflow: "auto",
    flexShrink: 0,
};

export const detailHeaderStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
};

export const detailEyebrowStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#66aec4",
    fontWeight: 700,
};

export const detailCloseButtonStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #33414a",
    background: "#101d26",
    color: "#9aa8b2",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
};

export const detailBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignSelf: "start",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
};

export const detailTitleStyle: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.3,
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

export const detailSubtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#7f99a7",
    wordBreak: "break-all",
    overflowWrap: "anywhere",
};

export const detailMetricGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 6,
};

export const detailMetricStyle: React.CSSProperties = {
    padding: 8,
    borderRadius: 8,
    background: "#101d26",
    border: "1px solid #1a2c38",
    minWidth: 0,
    overflow: "hidden",
};

export const detailMetricLabelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

export const detailMetricValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 700,
};

export const detailSectionTitleStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#7b9aaa",
    fontWeight: 700,
};

export const detailRowStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    minWidth: 0,
    overflow: "hidden",
};

export const detailLinkRowStyle: React.CSSProperties = {
    display: "grid",
    gap: 2,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    textAlign: "left",
    cursor: "pointer",
    color: "inherit",
    font: "inherit",
};

export const copilotMessagesStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "grid",
    gap: 10,
    alignContent: "start",
    paddingRight: 2,
};

export const copilotBubbleAssistantStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: "10px 10px 10px 4px",
    border: "1px solid #223849",
    background: "#0d1821",
    color: "#d9e6ec",
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
};

export const copilotBubbleUserStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: "10px 10px 4px 10px",
    border: "1px solid #1f4d40",
    background: "rgba(41, 161, 116, 0.14)",
    color: "#d9e6ec",
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    justifySelf: "end",
    maxWidth: "92%",
};

export const copilotSuggestionStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    color: "#9eb4c0",
    fontSize: 11,
    lineHeight: 1.2,
    cursor: "pointer",
    font: "inherit",
};

export const copilotInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    color: "#d9e6ec",
    fontSize: 13,
    font: "inherit",
    outline: "none",
};

export const copilotSendButtonStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #1f4d40",
    background: "rgba(41, 161, 116, 0.18)",
    color: "#7ce3b7",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    cursor: "pointer",
    font: "inherit",
};
