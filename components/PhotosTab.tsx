"use client";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, prepareImage } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { MediaItem, Participant, TripBundle } from "@/lib/types";
import type { RunMutation } from "./TripApp";
import StorageBar from "./StorageBar";
import { Avatar, Button, Card, cx, inputCls, Modal, SectionTitle } from "./ui";

async function upload(fields: Record<string, string>, file: File, maxDim: number, withThumb = false) {
  const img = await prepareImage(file, maxDim);
  const fd = new FormData();
  fd.append("file", img.blob, "image.jpg");
  // A small preview for the photo grid, so browsing doesn't download every full-size photo.
  if (withThumb) fd.append("thumb", (await prepareImage(file, 480, 0.75)).blob, "thumb.jpg");
  fd.append("width", String(img.width));
  fd.append("height", String(img.height));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch("/api/media", { method: "POST", body: fd, credentials: "same-origin" });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Upload failed (${res.status})`);
}

export default function PhotosTab({ bundle, unlocked, offline, run }: { bundle: TripBundle; unlocked: boolean; offline: boolean; run: RunMutation }) {
  const { t, locale } = useT();
  const tripId = bundle.trip.id;
  const [uploader, setUploader] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarFor = useRef<Participant | null>(null);

  useEffect(() => {
    try {
      setUploader(localStorage.getItem(`tms:me:${tripId}`) ?? "");
    } catch {}
  }, [tripId]);
  const chooseMe = (id: string) => {
    setUploader(id);
    try {
      localStorage.setItem(`tms:me:${tripId}`, id);
    } catch {}
  };
  const uploaderName = bundle.participants.find((p) => p.id === uploader)?.name ?? "";

  const addPhotos = async (files: File[]) => {
    setBusy("photos");
    let done = 0;
    for (const f of files) {
      const ok = await run(() => upload({ trip_id: tripId, kind: "photo", caption, uploaded_by: uploaderName }, f, 1600, true));
      if (ok) done++;
    }
    setBusy(null);
    if (done) setCaption("");
  };

  const setAvatar = async (p: Participant, f: File) => {
    setBusy(p.id);
    await run(() => upload({ trip_id: tripId, kind: "avatar", participant_id: p.id, uploaded_by: uploaderName }, f, 400), "Avatar updated");
    setBusy(null);
  };

  return (
    <div>
      <SectionTitle>{t("Travellers")}</SectionTitle>
      <Card className="p-3">
        <div className="flex flex-wrap gap-3">
          {bundle.participants.map((p) => (
            <button
              key={p.id}
              disabled={offline || busy !== null}
              onClick={() => {
                avatarFor.current = p;
                avatarInput.current?.click();
              }}
              className="group flex w-14 flex-col items-center gap-1"
              aria-label={t("Set avatar for {name}", { name: p.name })}
            >
              <span className="relative">
                <Avatar person={p} size={52} />
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-brand text-white ring-2 ring-surface">
                  {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px] text-ink-2">{p.name}</span>
            </button>
          ))}
          {bundle.participants.length === 0 && <p className="text-sm text-ink-3">{t("No travellers yet.")}</p>}
        </div>
        <p className="mt-2 text-xs text-ink-3">{t("Tap a face to upload an avatar (optional).")}</p>
        <input
          ref={avatarInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && avatarFor.current) setAvatar(avatarFor.current, f);
          }}
        />
      </Card>

      <SectionTitle>{t("Trip photos")}</SectionTitle>
      <StorageBar refreshKey={bundle.photos.length} />
      {!offline && (
        <Card className="mb-3 space-y-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <select className={inputCls} value={uploader} onChange={(e) => chooseMe(e.target.value)} aria-label={t("Who's uploading?")}>
              <option value="">{t("Who's uploading?")}</option>
              {bundle.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input className={inputCls} placeholder={t("Caption (optional)")} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} />
          </div>
          <Button className="w-full" disabled={busy !== null} onClick={() => photoInput.current?.click()}>
            {busy === "photos" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {busy === "photos" ? t("Uploading…") : t("Add photos")}
          </Button>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].slice(0, 20);
              e.target.value = "";
              if (files.length) addPhotos(files);
            }}
          />
        </Card>
      )}

      {bundle.photos.length === 0 ? (
        <Card className="p-6 text-center text-sm text-ink-2">{t("No photos yet — share the trip's best moments.")}</Card>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {bundle.photos.map((m) => (
            <button key={m.id} onClick={() => setViewing(m)} className="relative aspect-square overflow-hidden rounded-xl bg-stone-200" aria-label={m.caption ?? t("Photo")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${m.id}?size=thumb`} alt={m.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title={viewing.caption || t("Photo")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/media/${viewing.id}`} alt={viewing.caption ?? ""} className="w-full rounded-2xl" />
          <p className="mt-2 text-xs text-ink-3">
            {[viewing.uploaded_by, new Date(viewing.created_at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {unlocked && (
            <Button
              variant="danger"
              className={cx("mt-3 w-full")}
              onClick={async () => {
                if (!confirm(t("Delete this photo?"))) return;
                if (await run(() => api(`/api/media/${viewing.id}`, "DELETE"), "Deleted")) setViewing(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> {t("Delete photo")}
            </Button>
          )}
        </Modal>
      )}
    </div>
  );
}
