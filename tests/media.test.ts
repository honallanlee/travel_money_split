import { describe, expect, it } from "vitest";

// Force the in-memory store so this never touches a real database.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { getStore } from "@/lib/db/store";
import { createParticipant, createTrip, deleteMedia, deleteTrip, getMedia, storageUsage, uploadMedia } from "@/lib/repo";

const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n)]);

describe("photos go to file storage, avatars stay in the database", () => {
  it("stores photo + thumbnail as files and serves both", async () => {
    const trip = await createTrip({ name: "Media test" });
    const before = (await storageUsage()).photos.used;
    const item = await uploadMedia({ trip_id: trip.id, kind: "photo", participant_id: null, mime: "image/jpeg", data: jpeg(5000), thumb: jpeg(500), width: 10, height: 10, caption: "", uploaded_by: "" });
    const [row] = await getStore().select<{ data: string | null; storage_path: string; thumb_path: string; byte_size: number }>("media", { id: item.id });
    expect(row.data).toBeNull();
    expect(row.storage_path).toBe(`${trip.id}/${item.id}.jpg`);
    expect(row.byte_size).toBe(5003 + 503);
    expect((await getMedia(item.id))!.data.length).toBe(5003);
    expect((await getMedia(item.id, "thumb"))!.data.length).toBe(503);
    expect((await storageUsage()).photos.used - before).toBe(5506);

    await deleteMedia(item.id);
    expect(await getStore().getObject(row.storage_path)).toBeNull();
    expect(await getStore().getObject(row.thumb_path)).toBeNull();
    await deleteTrip(trip.id);
  });

  it("keeps avatars in the database", async () => {
    const trip = await createTrip({ name: "Avatar test" });
    const p = await createParticipant({ trip_id: trip.id, name: "Sam" });
    const item = await uploadMedia({ trip_id: trip.id, kind: "avatar", participant_id: p.id, mime: "image/jpeg", data: jpeg(800), width: 1, height: 1, caption: "", uploaded_by: "" });
    const [row] = await getStore().select<{ data: string | null; storage_path: string | null }>("media", { id: item.id });
    expect(row.data).not.toBeNull();
    expect(row.storage_path ?? null).toBeNull();
    expect((await getMedia(item.id))!.data.length).toBe(803);
    await deleteTrip(trip.id);
  });

  it("deleting a trip deletes its photo files", async () => {
    const trip = await createTrip({ name: "Delete test" });
    const item = await uploadMedia({ trip_id: trip.id, kind: "photo", participant_id: null, mime: "image/jpeg", data: jpeg(100), width: 1, height: 1, caption: "", uploaded_by: "" });
    const path = `${trip.id}/${item.id}.jpg`;
    expect(await getStore().getObject(path)).not.toBeNull();
    await deleteTrip(trip.id);
    expect(await getStore().getObject(path)).toBeNull();
  });
});
