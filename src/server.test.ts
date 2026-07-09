import { describe, expect, test } from "bun:test";
import {
    testBuildLiveCommand,
    testIsLoopbackAddress,
    testIsValidIface,
    testPacketMatchesBpf,
    testSanitizeBpf,
} from "./server";

describe("capture control surface", () => {
    test("builds tcpdump command from iface/dir/bpf via real helper", () => {
        const cmd = testBuildLiveCommand("eth0", "inout", "port 53");
        // may be prefixed with sudo depending on uid in test env
        expect(cmd[0] === "tcpdump" || cmd[0] === "sudo").toBe(true);
        expect(cmd).toContain("-i");
        expect(cmd).toContain("eth0");
        expect(cmd).toContain("-Q");
        expect(cmd).toContain("inout");
        // filter after option terminator, as single expression arg
        expect(cmd).toContain("--");
        const dashDash = cmd.indexOf("--");
        expect(cmd[dashDash + 1]).toBe("port 53");
    });

    test("defaults to any/out when empty", () => {
        const cmd = testBuildLiveCommand("any", "out", "");
        expect(cmd.join(" ")).toContain("-i any");
        expect(cmd.join(" ")).toContain("-Q out");
        expect(cmd).toContain("--");
    });

    test("rejects option-like BPF tokens when building command", () => {
        expect(() =>
            testBuildLiveCommand("any", "out", "-w /tmp/capture.pcap"),
        ).toThrow(/option-like/);
        expect(() =>
            testBuildLiveCommand("any", "out", "host 1.1.1.1 -A"),
        ).toThrow(/option-like/);
    });

    test("sanitizeBpf rejects flag-like tokens", () => {
        expect(testSanitizeBpf("-w /tmp/x")).toBe(null);
        expect(testSanitizeBpf("port 53 -i eth0")).toBe(null);
        expect(testSanitizeBpf("host 1.2.3.4")).toBe("host 1.2.3.4");
        expect(testSanitizeBpf("")).toBe("");
        expect(testSanitizeBpf("  ")).toBe("");
    });

    test("iface validation charset", () => {
        expect(testIsValidIface("any")).toBe(true);
        expect(testIsValidIface("eth0")).toBe(true);
        expect(testIsValidIface("en0")).toBe(true);
        expect(testIsValidIface("br-1234")).toBe(true);
        expect(testIsValidIface("veth0.100")).toBe(true);
        expect(testIsValidIface("bad iface")).toBe(false);
        expect(testIsValidIface("eth0;rm")).toBe(false);
        expect(testIsValidIface("-i")).toBe(false);
        expect(testIsValidIface("")).toBe(false);
    });

    test("invalid iface falls back to any in buildLiveCommand", () => {
        const cmd = testBuildLiveCommand("evil;rm", "out", "");
        expect(cmd).toContain("any");
        expect(cmd.join(" ")).not.toContain("evil");
    });

    test("loopback address helper", () => {
        expect(testIsLoopbackAddress("127.0.0.1")).toBe(true);
        expect(testIsLoopbackAddress("::1")).toBe(true);
        // Bun dual-stack requestIP form for IPv4 loopback clients
        expect(testIsLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
        expect(testIsLoopbackAddress("::ffff:10.0.0.1")).toBe(false);
        expect(testIsLoopbackAddress("192.168.1.5")).toBe(false);
        expect(testIsLoopbackAddress(null)).toBe(false);
    });

    test("BPF matcher allows host filter (exact)", () => {
        const pkt = {
            id: "p1",
            timestamp: "00:00:00.000000",
            proto: "UDP" as const,
            srcHost: "10.0.0.5",
            srcPort: 1234,
            dstHost: "8.8.8.8",
            dstPort: 53,
            length: 64,
            info: "",
        };
        expect(testPacketMatchesBpf(pkt, "host 8.8.8.8")).toBe(true);
        expect(testPacketMatchesBpf(pkt, "host 10.0.0.5")).toBe(true);
        expect(testPacketMatchesBpf(pkt, "host 1.1.1.1")).toBe(false);
    });

    test("BPF matcher allows port filter", () => {
        const pkt = {
            id: "p2",
            timestamp: "00:00:00.000000",
            proto: "TCP" as const,
            srcHost: "10.0.0.1",
            srcPort: 54321,
            dstHost: "10.0.0.2",
            dstPort: 443,
            length: 100,
            info: "",
        };
        expect(testPacketMatchesBpf(pkt, "port 443")).toBe(true);
        expect(testPacketMatchesBpf(pkt, "port 54321")).toBe(true);
        expect(testPacketMatchesBpf(pkt, "port 80")).toBe(false);
    });

    test("BPF matcher empty means pass-all (file replay regression guard)", () => {
        const pkt = {
            id: "p3",
            timestamp: "00:00:00.000000",
            proto: "TCP" as const,
            srcHost: "1.2.3.4",
            srcPort: 1,
            dstHost: "5.6.7.8",
            dstPort: 2,
            length: 40,
            info: "",
        };
        expect(testPacketMatchesBpf(pkt, "")).toBe(true);
        expect(testPacketMatchesBpf(pkt, "   ")).toBe(true);
    });

    test("BPF matcher with host+port ands", () => {
        const pkt = {
            id: "p4",
            timestamp: "00:00:00.000000",
            proto: "UDP" as const,
            srcHost: "192.168.1.10",
            srcPort: 123,
            dstHost: "192.168.1.1",
            dstPort: 53,
            length: 50,
            info: "",
        };
        expect(testPacketMatchesBpf(pkt, "host 192.168.1.10 and port 53")).toBe(
            true,
        );
        expect(testPacketMatchesBpf(pkt, "host 192.168.1.10 and port 80")).toBe(
            false,
        );
    });

    test("BPF matcher with host or port (documented example)", () => {
        const pktHostOnly = {
            id: "p5",
            timestamp: "00:00:00.000000",
            proto: "TCP" as const,
            srcHost: "192.168.1.10",
            srcPort: 9999,
            dstHost: "10.0.0.1",
            dstPort: 80,
            length: 40,
            info: "",
        };
        const pktPortOnly = {
            id: "p6",
            timestamp: "00:00:00.000000",
            proto: "UDP" as const,
            srcHost: "10.0.0.9",
            srcPort: 1234,
            dstHost: "8.8.8.8",
            dstPort: 53,
            length: 50,
            info: "",
        };
        const pktNeither = {
            id: "p7",
            timestamp: "00:00:00.000000",
            proto: "TCP" as const,
            srcHost: "10.0.0.9",
            srcPort: 1,
            dstHost: "10.0.0.8",
            dstPort: 80,
            length: 40,
            info: "",
        };
        const expr = "host 192.168.1.10 or port 53";
        expect(testPacketMatchesBpf(pktHostOnly, expr)).toBe(true);
        expect(testPacketMatchesBpf(pktPortOnly, expr)).toBe(true);
        expect(testPacketMatchesBpf(pktNeither, expr)).toBe(false);
    });
});
