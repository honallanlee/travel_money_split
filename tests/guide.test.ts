import { describe, expect, it } from "vitest";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

import { createTrip, getTripGuide, saveTripGuide } from "@/lib/repo";
import type { TripGuide } from "@/lib/types";

const guide: TripGuide = {
  title: "Test trip",
  startDate: "2026-12-12",
  endDate: "2026-12-13",
  notes: [{ title: "Note", lines: ["Bring cash"] }],
  flights: [{ kind: "flight", title: "XX123", private: ["PNR ABC123"] }],
  stays: [{ key: "h", name: "Hotel", nights: ["2026-12-12"], private: ["Booking #: 999"] }],
  days: [
    {
      day: 1,
      date: "2026-12-12",
      title: "Arrive",
      stay: "h",
      items: [
        {
          kind: "meal",
          title: "Dinner",
          private: ["Reservation code: SECRET1"],
          options: [{ kind: "meal", title: "Alt", private: ["Reservation code: SECRET2"] }],
        },
        { kind: "walk", title: "Walk" },
      ],
    },
  ],
};

describe("trip guide privacy", () => {
  it("strips every private line for viewers and flags where they were", async () => {
    const trip = await createTrip({ name: "Guide test", base_currency: "JPY" });
    await saveTripGuide(trip.id, guide);

    const publicView = await getTripGuide(trip.id, false);
    const text = JSON.stringify(publicView);
    for (const secret of ["ABC123", "999", "SECRET1", "SECRET2"]) expect(text).not.toContain(secret);
    expect(publicView!.days[0].items[0].hasPrivate).toBe(true);
    expect(publicView!.days[0].items[0].options![0].hasPrivate).toBe(true);
    expect(publicView!.days[0].items[1].hasPrivate).toBe(false);
    expect(publicView!.stays[0].hasPrivate).toBe(true);
    expect(publicView!.days[0].items[0].title).toBe("Dinner");

    const treasurerView = await getTripGuide(trip.id, true);
    expect(JSON.stringify(treasurerView)).toContain("SECRET2");
  });

  it("returns null for a trip without a guide and rejects malformed guides", async () => {
    const trip = await createTrip({ name: "No guide", base_currency: "JPY" });
    expect(await getTripGuide(trip.id, false)).toBeNull();
    await expect(saveTripGuide(trip.id, { title: "x" })).rejects.toThrow();
  });
});
