import { describe, expect, test } from "bun:test";
import { parseLsofOutput } from "./lsofCollector";
import { lookupProcess, socketKey } from "./processInfo";

const SAMPLE_OUTPUT = `COMMAND     PID              USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
Beside      800 williamseemueller   37u  IPv4 0x3916b0a1b3443b79      0t0  TCP 172.16.0.2:49551->216.239.38.120:443 (ESTABLISHED)
Google      900 williamseemueller   26u  IPv4 0xabc123456789abcd      0t0  UDP 10.0.0.5:5353->224.0.0.251:5353
jetbrains   788 williamseemueller  735u  IPv6 0xe4c815cedf9352f5      0t0  TCP 127.0.0.1:49211 (LISTEN)
curl       1200 williamseemueller    5u  IPv6 0x1111111111111111      0t0  TCP [fe80::1]:1024->[fe80::2]:443 (ESTABLISHED)
`;

describe("parseLsofOutput", () => {
    test("indexes established TCP sockets by tuple", () => {
        const table = parseLsofOutput(SAMPLE_OUTPUT);
        const key = socketKey(
            "TCP",
            "172.16.0.2",
            49551,
            "216.239.38.120",
            443,
        );

        expect(table.get(key)).toEqual({
            command: "Beside",
            pid: 800,
            user: "williamseemueller",
        });
    });

    test("indexes UDP sockets and normalizes IPv6 endpoints", () => {
        const table = parseLsofOutput(SAMPLE_OUTPUT);

        expect(
            lookupProcess(table, {
                proto: "UDP",
                srcHost: "10.0.0.5",
                srcPort: 5353,
                dstHost: "224.0.0.251",
                dstPort: 5353,
            }),
        ).toEqual({
            command: "Google",
            pid: 900,
            user: "williamseemueller",
        });

        expect(
            lookupProcess(table, {
                proto: "TCP",
                srcHost: "fe80::1",
                srcPort: 1024,
                dstHost: "fe80::2",
                dstPort: 443,
            }),
        ).toEqual({
            command: "curl",
            pid: 1200,
            user: "williamseemueller",
        });
    });

    test("ignores listen-only sockets", () => {
        const table = parseLsofOutput(SAMPLE_OUTPUT);
        expect(
            lookupProcess(table, {
                proto: "TCP",
                srcHost: "127.0.0.1",
                srcPort: 49211,
                dstHost: "127.0.0.1",
                dstPort: 49212,
            }),
        ).toBeUndefined();
    });
});
