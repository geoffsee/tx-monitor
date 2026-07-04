import { describe, expect, test } from "bun:test";
import { testBuildLiveCommand, testPacketMatchesBpf } from "./server";

describe("capture control surface", () => {
    test("builds tcpdump command from iface/dir/bpf", () => {
        const cmd = testBuildLiveCommand("eth0", "inout", "port 53");
        // may be prefixed with sudo depending on uid in test env
        expect(cmd[0] === "tcpdump" || cmd[0] === "sudo").toBe(true);
        expect(cmd).toContain("-i");
        expect(cmd).toContain("eth0");
        expect(cmd).toContain("-Q");
        expect(cmd).toContain("inout");
        expect(cmd).toContain("port");
        expect(cmd).toContain("53");
    });

    test("defaults to any/out when empty", () => {
        const cmd = testBuildLiveCommand("any", "out", "");
        expect(cmd.join(" ")).toContain("-i any");
        expect(cmd.join(" ")).toContain("-Q out");
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
});
