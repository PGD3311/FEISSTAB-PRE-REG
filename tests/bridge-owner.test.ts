import { describe, it, expect } from "vitest";
import {
  createOwnedEvent,
  generateRegistrationCode,
  shouldCreateStage,
} from "@/lib/bridge";

const listing = {
  id: "listing-1",
  name: "Newport Feis",
  feis_date: "2026-11-01",
  end_date: null,
  venue_name: null,
  venue_address: null,
};

describe("shouldCreateStage", () => {
  it("creates a stage only when there are none", () => {
    expect(shouldCreateStage(0)).toBe(true);
    expect(shouldCreateStage(1)).toBe(false);
  });
});

describe("generateRegistrationCode", () => {
  it("retries on collision", async () => {
    const codes = ["AAAAAA", "BBBBBB"];
    const taken = new Set(["AAAAAA"]);
    const code = await generateRegistrationCode(
      async (c) => taken.has(c),
      () => codes.shift()!,
    );
    expect(code).toBe("BBBBBB");
  });

  it("gives up after repeated collisions", async () => {
    await expect(generateRegistrationCode(async () => true)).rejects.toThrow();
  });

  it("makes 6 uppercase characters by default", async () => {
    expect(await generateRegistrationCode(async () => false)).toMatch(
      /^[0-9A-F]{6}$/,
    );
  });
});

interface Calls {
  upserts: { table: string; row: Record<string, unknown>; opts: unknown }[];
  inserts: { table: string; row: Record<string, unknown> }[];
}

function fakeClient(
  existing: Record<string, unknown> | null,
  stageCount: number,
) {
  const calls: Calls = { upserts: [], inserts: [] };
  const client = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: existing, error: null }),
        single: () => Promise.resolve({ data: { id: "event-1" }, error: null }),
        upsert: (row: Record<string, unknown>, opts: unknown) => {
          calls.upserts.push({ table, row, opts });
          return table === "events"
            ? builder
            : Promise.resolve({ error: null });
        },
        insert: (row: Record<string, unknown>) => {
          calls.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ count: stageCount, data: null, error: null }),
      };
      return builder;
    },
  };
  return {
    client: client as unknown as Parameters<typeof createOwnedEvent>[0],
    calls,
  };
}

describe("createOwnedEvent", () => {
  it("sets owner and code, adds role, stage and audit on a first launch", async () => {
    const { client, calls } = fakeClient(null, 0);
    await createOwnedEvent(client, listing, "user-1");
    const event = calls.upserts.find((u) => u.table === "events")!.row;
    expect(event.created_by).toBe("user-1");
    expect(event.registration_code).toMatch(/^[0-9A-F]{6}$/);
    const role = calls.upserts.find((u) => u.table === "event_roles")!;
    expect(role.row).toMatchObject({
      user_id: "user-1",
      event_id: "event-1",
      role: "organizer",
    });
    expect(role.opts).toEqual({
      onConflict: "user_id,event_id,role",
      ignoreDuplicates: true,
    });
    expect(calls.inserts.find((i) => i.table === "stages")!.row).toEqual(
      [1, 2, 3, 4, 5].map((n) => ({
        event_id: "event-1",
        name: `Stage ${n}`,
        display_order: n,
      })),
    );
    expect(
      calls.inserts.find((i) => i.table === "audit_log")!.row,
    ).toMatchObject({
      action: "launch_from_registration",
      entity_type: "event",
    });
  });

  it("keeps an existing owner and code and skips the stage on a re-run", async () => {
    const { client, calls } = fakeClient(
      { id: "event-1", created_by: "user-0", registration_code: "ABC123" },
      1,
    );
    await createOwnedEvent(client, listing, "user-1");
    const event = calls.upserts.find((u) => u.table === "events")!.row;
    expect("created_by" in event).toBe(false);
    expect("registration_code" in event).toBe(false);
    expect(calls.inserts.some((i) => i.table === "stages")).toBe(false);
  });
});
