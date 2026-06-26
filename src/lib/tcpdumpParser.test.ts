import { describe, expect, test } from "bun:test";
import {
    formatService,
    type PacketProto,
    TcpdumpParser,
} from "./tcpdumpParser";

describe("TcpdumpParser", () => {
    test("parses IPv4 two-line tcp packets", () => {
        const parser = new TcpdumpParser();
        const header =
            "13:15:11.048076 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF], proto TCP (6), length 64, bad cksum 0 (->3cb6)!)";
        const flow =
            "    10.1.2.3.40001 > 10.4.5.6.40002: Flags [S.], cksum 0xfe34 (incorrect -> 0xcc1e), length 0";

        expect(parser.parseLine(header)).toBeNull();
        const packet = parser.parseLine(flow);
        expect(packet).toMatchObject({
            timestamp: "13:15:11.048076",
            proto: "TCP",
            srcHost: "10.1.2.3",
            srcPort: 40001,
            dstHost: "10.4.5.6",
            dstPort: 40002,
            length: 64,
        });
    });

    test("parses IPv6 single-line udp packets", () => {
        const parser = new TcpdumpParser();
        const line =
            "13:15:11.058769 IP (tos 0x0, ttl 64, id 0, offset 0, flags [DF], proto UDP (17), length 74) 10.20.30.40.12345 > 203.0.113.50.443: [udp sum ok] quic, protected";

        const packet = parser.parseLine(line);
        expect(packet).toMatchObject({
            proto: "UDP",
            srcHost: "10.20.30.40",
            srcPort: 12345,
            dstHost: "203.0.113.50",
            dstPort: 443,
            length: 74,
            info: "[udp sum ok] quic, protected",
        });
    });
});

describe("formatService", () => {
    test("maps well-known ports to service names", () => {
        expect(formatService(443, "TCP" as PacketProto)).toBe("HTTPS");
        expect(formatService(80, "TCP" as PacketProto)).toBe("HTTP");
        expect(formatService(53, "UDP" as PacketProto)).toBe("DNS");
    });

    test("falls back to proto/port for unknown ports", () => {
        expect(formatService(8080, "TCP" as PacketProto)).toBe("TCP/8080");
        expect(formatService(12345, "UDP" as PacketProto)).toBe("UDP/12345");
        expect(formatService(9999, "OTHER" as PacketProto)).toBe("OTHER/9999");
    });

    test("returns proto only when port is null", () => {
        expect(formatService(null, "ICMP" as PacketProto)).toBe("ICMP");
        expect(formatService(null, "TCP" as PacketProto)).toBe("TCP");
    });
});
