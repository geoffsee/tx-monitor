import { describe, expect, test } from "bun:test";
import { openDatabase } from "./client";
import { TrafficStore } from "./store";

function createTestStore() {
    return new TrafficStore(openDatabase(":memory:"));
}

describe("TrafficStore", () => {
    test("persists sessions and packets", () => {
        const store = createTestStore();
        const session = store.startSession("file", "file tcpdump.log");

        store.savePackets([
            {
                id: "pkt-1",
                timestamp: "12:00:00.123456",
                proto: "TCP",
                srcHost: "192.168.1.1",
                srcPort: 443,
                dstHost: "10.0.0.2",
                dstPort: 52000,
                length: 64,
                info: "Flags [S]",
            },
            {
                id: "pkt-2",
                timestamp: "12:00:00.234567",
                proto: "UDP",
                srcHost: "10.0.0.2",
                srcPort: 52000,
                dstHost: "8.8.8.8",
                dstPort: 53,
                length: 128,
                info: "DNS query",
            },
        ]);

        const sessions = store.listSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.id).toBe(session.id);
        expect(sessions[0]?.totalPackets).toBe(2);
        expect(sessions[0]?.totalBytes).toBe(192);
        expect(sessions[0]?.hostname).toBeNull();
        expect(sessions[0]?.cmdline).toBeNull();
        expect(sessions[0]?.notes).toBeNull();
        expect(sessions[0]?.tags).toBeNull();

        const recent = store.listRecentPackets(10, session.id);
        expect(recent).toHaveLength(2);
        expect(recent.map((packet) => packet.id)).toEqual(["pkt-2", "pkt-1"]);

        store.endSession();
        const ended = store.listSessions()[0];
        expect(ended?.endedAt).not.toBeNull();
    });

    test("ignores duplicate packet ids", () => {
        const store = createTestStore();
        const session = store.startSession("live", "tcpdump");
        const packet = {
            id: "pkt-dup",
            timestamp: "12:00:00.000000",
            proto: "TCP" as const,
            srcHost: "1.1.1.1",
            srcPort: 443,
            dstHost: "2.2.2.2",
            dstPort: 8080,
            length: 40,
            info: "duplicate",
        };

        store.savePackets([packet]);
        store.savePackets([packet]);

        const sessions = store.listSessions();
        expect(sessions[0]?.totalPackets).toBe(1);
        expect(store.listRecentPackets(10, session.id)).toHaveLength(1);
    });

    test("loads session packets in chronological order", () => {
        const store = createTestStore();
        const session = store.startSession("file", "file tcpdump.log");

        store.savePackets([
            {
                id: "pkt-a",
                timestamp: "12:00:00.100000",
                proto: "TCP",
                srcHost: "1.1.1.1",
                srcPort: 443,
                dstHost: "2.2.2.2",
                dstPort: 8080,
                length: 10,
                info: "first",
            },
            {
                id: "pkt-b",
                timestamp: "12:00:00.200000",
                proto: "UDP",
                srcHost: "1.1.1.1",
                srcPort: 443,
                dstHost: "2.2.2.2",
                dstPort: 8080,
                length: 20,
                info: "second",
            },
        ]);

        expect(store.getSession(session.id)?.totalPackets).toBe(2);
        expect(
            store
                .listSessionPackets(session.id, 0, 10)
                .map((packet) => packet.id),
        ).toEqual(["pkt-a", "pkt-b"]);
    });

    test("captures and updates extended session metadata", () => {
        const store = createTestStore();
        const session = store.startSession("live", "tcpdump -i any", {
            hostname: "testhost",
            cmdline: "tcpdump -i any -Q out",
            notes: "initial note",
            tags: "test,net",
        });

        let loaded = store.getSession(session.id);
        expect(loaded?.hostname).toBe("testhost");
        expect(loaded?.cmdline).toBe("tcpdump -i any -Q out");
        expect(loaded?.notes).toBe("initial note");
        expect(loaded?.tags).toBe("test,net");

        store.updateSessionMetadata(session.id, {
            notes: "updated reason for capture",
            tags: "prod,incident-42",
        });

        loaded = store.getSession(session.id);
        expect(loaded?.notes).toBe("updated reason for capture");
        expect(loaded?.tags).toBe("prod,incident-42");
        // hostname/cmdline unchanged
        expect(loaded?.hostname).toBe("testhost");
    });

    test("stores multiple sessions with isolated packet sets", () => {
        const store = createTestStore();
        const s1 = store.startSession("file", "ref capture");
        store.savePackets([
            {
                id: "s1-p1",
                timestamp: "10:00:00.000000",
                proto: "TCP",
                srcHost: "10.0.0.1",
                srcPort: 1234,
                dstHost: "8.8.8.8",
                dstPort: 53,
                length: 64,
                info: "s1",
            },
        ]);
        store.endSession();

        const s2 = store.startSession("file", "incident capture");
        store.savePackets([
            {
                id: "s2-p1",
                timestamp: "11:00:00.000000",
                proto: "UDP",
                srcHost: "10.0.0.2",
                srcPort: 4321,
                dstHost: "1.1.1.1",
                dstPort: 53,
                length: 128,
                info: "s2",
            },
        ]);
        store.endSession();

        const all = store.listSessions(10);
        expect(all.length).toBeGreaterThanOrEqual(2);

        const p1 = store.listSessionPackets(s1.id, 0, 10);
        const p2 = store.listSessionPackets(s2.id, 0, 10);
        expect(p1.map((p) => p.id)).toEqual(["s1-p1"]);
        expect(p2.map((p) => p.id)).toEqual(["s2-p1"]);
        // Cross fetch by explicit session returns empty for wrong id
        expect(
            store.listRecentPackets(10, s1.id).some((p) => p.id === "s2-p1"),
        ).toBe(false);
    });

    test("persists and updates entity markers for hosts and flows", () => {
        const store = createTestStore();
        const session = store.startSession("file", "test-session");

        store.setEntityMarker(session.id, {
            kind: "host",
            entityId: "10.0.0.5",
            pinned: true,
            note: "primary host",
            tags: "lab,important",
        });
        store.setEntityMarker(session.id, {
            kind: "flow",
            entityId: "10.0.0.5->8.8.8.8:UDP:53",
            pinned: false,
            note: "dns flow",
            tags: null,
        });

        let markers = store.getEntityMarkers(session.id);
        expect(markers.length).toBe(2);
        const hostM = markers.find((m) => m.kind === "host");
        expect(hostM?.id).toBe("10.0.0.5");
        expect(hostM?.pinned).toBe(true);
        expect(hostM?.note).toBe("primary host");
        expect(hostM?.tags).toBe("lab,important");

        // update note only, preserve pin
        store.setEntityMarker(session.id, {
            kind: "host",
            entityId: "10.0.0.5",
            note: "updated note",
        });
        markers = store.getEntityMarkers(session.id);
        const updatedHost = markers.find((m) => m.kind === "host");
        expect(updatedHost?.note).toBe("updated note");
        expect(updatedHost?.pinned).toBe(true);

        // clear by removing content
        store.setEntityMarker(session.id, {
            kind: "flow",
            entityId: "10.0.0.5->8.8.8.8:UDP:53",
            pinned: false,
            note: null,
            tags: null,
        });
        markers = store.getEntityMarkers(session.id);
        expect(markers.find((m) => m.kind === "flow")).toBeUndefined();
        expect(markers.length).toBe(1);
    });
});
