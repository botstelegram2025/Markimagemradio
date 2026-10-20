import io
import os
import re
import zipfile

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from mutagen.mp3 import MP3, HeaderNotFoundError
from mutagen.id3 import ID3
from pydantic import BaseModel

from core import (db, now_iso, new_id, require_roles, STAFF, store_file, read_file, audit, get_settings,
                  log_error)

router = APIRouter()
staff = require_roles(*STAFF)
MAX_FILE = 30 * 1024 * 1024


def _tag(tags, key):
    try:
        v = tags.get(key)
        return str(v.text[0]).strip() if v and v.text else ""
    except Exception:
        return ""


async def ingest_mp3(data: bytes, filename: str, genre: str, package_id: str, user: dict):
    """Validates and stores one MP3. Returns (status, track_id, reason)."""
    if not filename.lower().endswith(".mp3"):
        return "rejected", None, "Formato não permitido (somente MP3)"
    if len(data) > MAX_FILE:
        return "rejected", None, "Arquivo maior que 30 MB"
    try:
        audio = MP3(io.BytesIO(data))
        duration = round(audio.info.length, 2)
        if duration < 5:
            raise HeaderNotFoundError("too short")
    except Exception:
        return "rejected", None, "Arquivo corrompido ou inválido"
    import hashlib
    sha1 = hashlib.sha1(data).hexdigest()
    dup = await db.tracks.find_one({"sha1": sha1, "status": {"$ne": "excluida"}}, {"_id": 0})
    if dup:
        return "duplicate", dup["id"], f"Duplicada de '{dup['title']}'"
    title, artist, tgenre, cover = "", "", "", None
    try:
        tags = ID3(io.BytesIO(data))
        title, artist, tgenre = _tag(tags, "TIT2"), _tag(tags, "TPE1"), _tag(tags, "TCON")
        apic = tags.getall("APIC")
        if apic:
            cover = apic[0]
    except Exception:
        pass
    base = os.path.splitext(os.path.basename(filename))[0]
    if not title:
        if " - " in base:
            artist, title = [x.strip() for x in base.split(" - ", 1)]
        else:
            title = base
    f = await store_file("music", data, "audio/mpeg", "mp3", os.path.basename(filename), uploaded_by=user["id"])
    cover_id = None
    if cover is not None:
        try:
            ext = "png" if "png" in cover.mime else "jpg"
            cover_id = (await store_file("cover", cover.data, cover.mime or "image/jpeg", ext))["id"]
        except Exception:
            cover_id = None
    tid = new_id()
    await db.tracks.insert_one({"id": tid, "title": title[:200], "artist": artist[:200] or "Desconhecido",
                                "genre": genre or tgenre or "Geral", "duration": duration, "file_id": f["id"],
                                "cover_file_id": cover_id, "package_id": package_id, "sha1": sha1,
                                "source_filename": os.path.basename(filename), "status": "ativa", "play_count": 0,
                                "last_played_at": None, "created_by": user["id"], "created_at": now_iso()})
    return "accepted", tid, ""


async def finalize_package(pkg_id, name, source, results, user):
    track_ids = [r["track_id"] for r in results if r["status"] == "accepted"]
    tracks = await db.tracks.find({"id": {"$in": track_ids}}, {"_id": 0, "id": 1, "duration": 1}).to_list(10000)
    dur = {t["id"]: t["duration"] for t in tracks}
    pkg = {"id": pkg_id, "name": name, "source": source, "track_ids": track_ids,
           "total_duration": round(sum(dur.get(t, 0) for t in track_ids), 1),
           "accepted": sum(r["status"] == "accepted" for r in results),
           "duplicates": [r for r in results if r["status"] == "duplicate"],
           "rejected": [r for r in results if r["status"] == "rejected"],
           "created_by": user["id"], "created_at": now_iso()}
    await db.music_packages.insert_one(dict(pkg))
    await audit(user, "music_import", "music_package", pkg_id, {"accepted": pkg["accepted"],
                                                                "rejected": len(pkg["rejected"])})
    playlist = await build_playlist(user, f"Importação: {name}") if track_ids else None
    pkg["playlist_version"] = playlist and playlist["version"]
    return pkg


async def build_playlist(user, reason="Reconstrução manual"):
    s = await get_settings()
    max_s = float(s["playlist_max_hours"]) * 3600
    pkgs = await db.music_packages.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    active = {t["id"]: t for t in await db.tracks.find({"status": "ativa"}, {"_id": 0}).to_list(50000)}
    items, seen, total, full = [], set(), 0.0, False
    for pkg in pkgs:
        for tid in pkg["track_ids"]:
            t = active.get(tid)
            if not t or tid in seen:
                continue
            if total + t["duration"] > max_s:
                full = True
                break
            items.append(tid)
            seen.add(tid)
            total += t["duration"]
        if full:
            break
    last = await db.playlists.find_one({}, {"_id": 0}, sort=[("version", -1)])
    version = (last["version"] + 1) if last else 1
    pl = {"id": new_id(), "version": version, "items": items, "total_duration": round(total, 1),
          "reason": reason, "active": True, "created_by": (user or {}).get("id"), "created_at": now_iso()}
    await db.playlists.update_many({"active": True}, {"$set": {"active": False}})
    await db.playlists.insert_one(dict(pl))
    return pl


@router.post("/admin/music/upload")
async def upload_tracks(files: list[UploadFile] = File(...), genre: str = Form(""), package_name: str = Form(""),
                        user=Depends(staff)):
    pkg_id = new_id()
    results = []
    for f in files[:200]:
        data = await f.read()
        st, tid, reason = await ingest_mp3(data, f.filename or "arquivo", genre, pkg_id, user)
        results.append({"file": f.filename, "status": st, "track_id": tid, "reason": reason})
    return await finalize_package(pkg_id, package_name or f"Envio avulso {now_iso()[:10]}", "upload", results, user)


@router.post("/admin/music/upload-zip")
async def upload_zip(file: UploadFile = File(...), genre: str = Form(""), package_name: str = Form(""),
                     user=Depends(staff)):
    data = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Arquivo ZIP inválido ou corrompido")
    pkg_id = new_id()
    results = []
    names = sorted(n for n in zf.namelist() if not n.endswith("/") and "__MACOSX" not in n)
    for n in names[:2000]:
        try:
            st, tid, reason = await ingest_mp3(zf.read(n), n, genre, pkg_id, user)
        except Exception as e:
            await log_error("music_zip", f"{n}: {e}")
            st, tid, reason = "rejected", None, "Falha ao processar"
        results.append({"file": n, "status": st, "track_id": tid, "reason": reason})
    name = package_name or re.sub(r"\.zip$", "", file.filename or "Pacote", flags=re.I)
    return await finalize_package(pkg_id, name, "zip", results, user)


@router.get("/admin/music/tracks")
async def list_tracks(q: str = "", status: str = "", package_id: str = "", genre: str = "", user=Depends(staff)):
    query = {"status": {"$ne": "excluida"}}
    if status:
        query["status"] = status
    if package_id:
        query["package_id"] = package_id
    if genre:
        query["genre"] = genre
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"title": rx}, {"artist": rx}]
    tracks = await db.tracks.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    genres = await db.tracks.distinct("genre", {"status": {"$ne": "excluida"}})
    return {"tracks": tracks, "genres": genres}


class TrackPatch(BaseModel):
    title: str | None = None
    artist: str | None = None
    genre: str | None = None
    status: str | None = None


@router.patch("/admin/music/tracks/{tid}")
async def patch_track(tid: str, body: TrackPatch, user=Depends(staff)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in upd and upd["status"] not in ("ativa", "pausada", "retirada", "excluida"):
        raise HTTPException(400, "Status inválido")
    r = await db.tracks.update_one({"id": tid}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(404, "Música não encontrada")
    await audit(user, "track_update", "track", tid, upd)
    return await db.tracks.find_one({"id": tid}, {"_id": 0})


@router.delete("/admin/music/tracks/{tid}")
async def delete_track(tid: str, user=Depends(staff)):
    await db.tracks.update_one({"id": tid}, {"$set": {"status": "excluida", "deleted_at": now_iso()}})
    await audit(user, "track_delete", "track", tid)
    return {"ok": True}


@router.get("/admin/music/packages")
async def list_packages(user=Depends(staff)):
    return await db.music_packages.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/admin/music/duplicates")
async def duplicates(user=Depends(staff)):
    pipe = [{"$match": {"status": {"$ne": "excluida"}}},
            {"$group": {"_id": {"t": {"$toLower": "$title"}, "a": {"$toLower": "$artist"}},
                        "count": {"$sum": 1}, "tracks": {"$push": {"id": "$id", "title": "$title",
                                                                   "artist": "$artist", "status": "$status"}}}},
            {"$match": {"count": {"$gt": 1}}}]
    return [{"title": g["tracks"][0]["title"], "artist": g["tracks"][0]["artist"], "tracks": g["tracks"]}
            async for g in db.tracks.aggregate(pipe)]


@router.post("/admin/music/verify")
async def verify_files(user=Depends(staff)):
    tracks = await db.tracks.find({"status": {"$in": ["ativa", "pausada", "indisponivel"]}}, {"_id": 0}).to_list(5000)
    missing = 0
    for t in tracks:
        f = await db.files.find_one({"id": t["file_id"]}, {"_id": 0})
        ok = bool(f)
        if ok:
            try:
                await read_file(f)
            except Exception:
                ok = False
        if not ok:
            missing += 1
            await db.tracks.update_one({"id": t["id"]}, {"$set": {"status": "indisponivel"}})
        elif t["status"] == "indisponivel":
            await db.tracks.update_one({"id": t["id"]}, {"$set": {"status": "ativa"}})
    await audit(user, "music_verify", "tracks", None, {"checked": len(tracks), "missing": missing})
    return {"checked": len(tracks), "missing": missing}


@router.post("/admin/playlists/build")
async def rebuild(user=Depends(staff)):
    pl = await build_playlist(user)
    await audit(user, "playlist_build", "playlist", pl["id"], {"version": pl["version"]})
    return pl


@router.get("/admin/playlists")
async def playlists(user=Depends(staff)):
    return await db.playlists.find({}, {"_id": 0, "items": 0}).sort("version", -1).to_list(100)


@router.get("/admin/playlists/active")
async def active_playlist(user=Depends(staff)):
    pl = await db.playlists.find_one({"active": True}, {"_id": 0})
    if not pl:
        return {"playlist": None, "items": []}
    tracks = {t["id"]: t for t in await db.tracks.find({"id": {"$in": pl["items"]}}, {"_id": 0}).to_list(50000)}
    items = [tracks[i] for i in pl["items"] if i in tracks]
    pl.pop("items")
    return {"playlist": pl, "items": items}
