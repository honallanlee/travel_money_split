"use client";
import { Plus, Star, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { CURRENCIES, type MiniGroup, type Participant, type TripBundle } from "@/lib/types";
import type { RunMutation } from "./TripApp";
import { useT } from "@/lib/i18n";
import { Avatar, Button, cx, Field, inputCls, Modal, SectionTitle } from "./ui";

export default function PeopleModal({ bundle, run, onClose }: { bundle: TripBundle; run: RunMutation; onClose: () => void }) {
  const router = useRouter();
  const { t } = useT();
  const tripId = bundle.trip.id;
  const [tripName, setTripName] = useState(bundle.trip.name);
  const [baseCur, setBaseCur] = useState(bundle.trip.base_currency);
  const [newPerson, setNewPerson] = useState("");
  const [newPersonGroup, setNewPersonGroup] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const hasTx = bundle.transactions.length > 0;
  const tripDirty = tripName.trim() !== bundle.trip.name || baseCur !== bundle.trip.base_currency;

  return (
    <Modal open onClose={onClose} title={t("Trip & travellers")}>
      <SectionTitle>{t("Trip")}</SectionTitle>
      <div className="space-y-3">
        <Field label={t("Trip name")}>
          <input className={inputCls} value={tripName} onChange={(e) => setTripName(e.target.value)} />
        </Field>
        <Field label={t("Base currency")} hint={hasTx ? t("Changing this won't convert existing amounts.") : undefined}>
          <select className={inputCls} value={baseCur} onChange={(e) => setBaseCur(e.target.value)}>
            {[...new Set([baseCur, ...CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {tripDirty && (
          <Button className="w-full" onClick={() => run(() => api(`/api/trips/${tripId}`, "PUT", { name: tripName, base_currency: baseCur }), "Trip updated")}>
            {t("Save trip")}
          </Button>
        )}
      </div>

      <SectionTitle>{t("Families / mini-groups")}</SectionTitle>
      <p className="mb-2 px-1 text-xs text-ink-3">{t("People in the same group settle up together as one unit.")}</p>
      <div className="space-y-2">
        {bundle.mini_groups.map((g) => (
          <GroupRow key={g.id} group={g} count={bundle.participants.filter((p) => p.mini_group_id === g.id).length} run={run} />
        ))}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api("/api/mini-groups", "POST", { trip_id: tripId, name: newGroup }), "Group added")) setNewGroup("");
          }}
        >
          <input className={inputCls} placeholder={t("e.g. Smith Family")} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} aria-label={t("New group name")} />
          <Button type="submit" variant="secondary" disabled={!newGroup.trim()} aria-label={t("Add group")}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <SectionTitle>{t("Travellers")}</SectionTitle>
      <div className="space-y-2">
        {bundle.participants.map((p) => (
          <PersonRow key={p.id} person={p} groups={bundle.mini_groups} run={run} />
        ))}
        <form
          className="space-y-2 rounded-2xl bg-surface p-3 ring-1 ring-line"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(
              () =>
                api("/api/participants", "POST", {
                  trip_id: tripId,
                  name: newPerson,
                  mini_group_id: newPersonGroup || null,
                  is_treasurer: bundle.participants.length === 0,
                }),
              "Traveller added",
            );
            if (ok) setNewPerson("");
          }}
        >
          <input className={inputCls} placeholder={t("Name")} value={newPerson} onChange={(e) => setNewPerson(e.target.value)} aria-label={t("New traveller name")} />
          <div className="flex gap-2">
            <select className={cx(inputCls, "flex-1")} value={newPersonGroup} onChange={(e) => setNewPersonGroup(e.target.value)} aria-label={t("Group for new traveller")}>
              <option value="">{t("Solo (no group)")}</option>
              {bundle.mini_groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!newPerson.trim()}>
              <Plus className="h-4 w-4" /> {t("Add")}
            </Button>
          </div>
        </form>
      </div>

      <SectionTitle>{t("Danger zone")}</SectionTitle>
      <Button
        variant="danger"
        className="w-full"
        onClick={async () => {
          if (!confirm(t('Delete "{name}" and all its data? This cannot be undone.', { name: bundle.trip.name }))) return;
          if (await run(() => api(`/api/trips/${tripId}`, "DELETE"))) router.push("/");
        }}
      >
        <Trash2 className="h-4 w-4" /> {t("Delete trip")}
      </Button>
    </Modal>
  );
}

function GroupRow({ group, count, run }: { group: MiniGroup; count: number; run: RunMutation }) {
  const { t } = useT();
  const [name, setName] = useState(group.name);
  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 shrink-0 text-ink-3" />
      <input
        className={cx(inputCls, "py-2")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== group.name && run(() => api(`/api/mini-groups/${group.id}`, "PUT", { name }), "Group renamed")}
        aria-label={t("Group name")}
      />
      <span className="shrink-0 text-xs text-ink-3">{count}</span>
      <button
        className="rounded-lg p-2 text-ink-3 hover:bg-red-50 hover:text-neg"
        aria-label={t("Delete {name}", { name: group.name })}
        onClick={() => confirm(t('Delete "{name}"? Members become solo travellers.', { name: group.name })) && run(() => api(`/api/mini-groups/${group.id}`, "DELETE"), "Group deleted")}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function PersonRow({ person, groups, run }: { person: Participant; groups: MiniGroup[]; run: RunMutation }) {
  const { t } = useT();
  const [name, setName] = useState(person.name);
  const put = (patch: Partial<Participant>, msg: string) => run(() => api(`/api/participants/${person.id}`, "PUT", patch), msg);
  return (
    <div className="rounded-2xl bg-surface p-2.5 ring-1 ring-line">
      <div className="flex items-center gap-2">
        <Avatar person={person} size={36} />
        <input
          className={cx(inputCls, "py-2 font-medium")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== person.name && put({ name }, "Renamed")}
          aria-label={t("Traveller name")}
        />
        <button
          className={cx("rounded-lg p-2", person.is_treasurer ? "text-amber-500" : "text-ink-3 hover:bg-stone-100")}
          aria-label={person.is_treasurer ? t("{name} is the Treasurer", { name: person.name }) : t("Make {name} the Treasurer", { name: person.name })}
          aria-pressed={person.is_treasurer}
          title={t("Treasurer (holds the cash kitty)")}
          onClick={() => !person.is_treasurer && put({ is_treasurer: true }, "Treasurer updated")}
        >
          <Star className="h-4 w-4" fill={person.is_treasurer ? "currentColor" : "none"} />
        </button>
        <button
          className="rounded-lg p-2 text-ink-3 hover:bg-red-50 hover:text-neg"
          aria-label={t("Remove {name}", { name: person.name })}
          onClick={() =>
            confirm(t("Remove {name}? Their expense shares will be deleted and card payments un-attributed.", { name: person.name })) &&
            run(() => api(`/api/participants/${person.id}`, "DELETE"), "Removed")
          }
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <select
        className={cx(inputCls, "mt-2 py-1.5 text-sm")}
        value={person.mini_group_id ?? ""}
        onChange={(e) => put({ mini_group_id: e.target.value || null }, "Group updated")}
        aria-label={t("Group for {name}", { name: person.name })}
      >
        <option value="">{t("Solo (no group)")}</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}
