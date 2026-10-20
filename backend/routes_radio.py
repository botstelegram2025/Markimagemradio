import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from core import (db, now, now_iso, new_id, local_now, get_current_user, require_roles, STAFF, ROLE_CLIENT,
                  ROLE_SUPER, AD_PLAYABLE, read_file, subscription_access, ad_is_eligible, audit, log_error)

router = APIRouter()
P = {"_id": 0}
DEFAULT_RULES = {
    "mode": "every_n", "every_n": 3, "every_minutes": 15, "ads_per_break": 2, "max_break_seconds": 120,
    "max_ad_seconds_per_hour": 480, "order": "priority", "priority_categories": [], "ads_paused": False,
    "max_repeats_per_hour": 4, "peak_hours": [], "peak_ads_per_break": 3, "low_hours": [],
    "dayparts": [], "campaign": {"enabled": False, "start_date": "", "end_date": "", "every_n": 1},
    "enabled": True,
}
RULE_KEYS = tuple(DEFAULT_RULES)


async def get_rules(business_id):
    g = await db.programming_rules.find_one({"scope": "global"}, P) or {}
    rules = {**DEFAULT_RULES, **{k: g[k] for k in RULE_KEYS if k in g}}
    o = await db.programming_rules.find_one({"scope": "business", "business_id": business_id}, P)
    if o and o.get("enabled"):
        rules.update({k: o[k] for k in RULE_KEYS if k in o and k != "enabled"})
    return rules


def media_url(fid):
    return f"/api/media/{fid}" if fid else None


async def pick_break(business_id, rules, dt):
    ads = await db.ads.find({"business_id": {"$in": [business_id, None]}, "status": {"$in": list(AD_PLAYABLE)}},
                            P).to_list(500)
    ads = [a for a in ads if ad_is_eligible(a, dt)]
    if not ads:
        return []
    since = (now() - timedelta(hours=1)).isoformat()
    recent = await db.playback_history.find({"business_id": business_id, "type": "ad", "started_at": {"$gte": since}},
                                            P).to_list(2000)
    used = sum(r.get("duration", 0) for r in recent)
    counts, last = {}, {}
    for r in recent:
        counts[r["ref_id"]] = counts.get(r["ref_id"], 0) + 1
        last[r["ref_id"]] = max(last.get(r["ref_id"], ""), r["started_at"])
    cap = int(rules["max_repeats_per_hour"] or 99)
    ads = [a for a in ads if counts.get(a["id"], 0) < min(cap, int(a.get("frequency_per_hour") or 99) or 99)]
    pc = rules.get("priority_categories") or []
    if rules["order"] == "random":
        random.shuffle(ads)
    elif rules["order"] == "rotation":
        ads.sort(key=lambda a: last.get(a["id"], ""))
    else:
        ads.sort(key=lambda a: (a.get("category_id") not in pc, -int(a.get("priority", 3)), last.get(a["id"], "")))
    n = rules["peak_ads_per_break"] if dt.hour in (rules.get("peak_hours") or []) else rules["ads_per_break"]
    budget = float(rules["max_ad_seconds_per_hour"] or 1e9) - used
    out, total = [], 0.0
    for a in ads:
        d = float(a.get("duration") or 0)
        if len(out) >= int(n) or total + d > float(rules["max_break_seconds"]) or total + d > budget:
            continue
        out.append(a)
        total += d
    return out


def break_due(state, rules, dt):
    if rules["ads_paused"] or dt.hour in (rules.get("low_hours") or []):
        return False
    every_n = int(rules["every_n"] or 1)
    camp = rules.get("campaign") or {}
    d = dt.date().isoformat()
    if camp.get("enabled") and camp.get("start_date", "") <= d <= (camp.get("end_date") or "9999"):
        every_n = int(camp.get("every_n") or 1)
    if rules["mode"] == "time":
        lb = state.get("last_break_at")
        return not lb or datetime.fromisoformat(lb) + timedelta(minutes=int(rules["every_minutes"])) <= now()
    return state.get("songs_since_break", 0) >= every_n


async def next_track(state, rules, dt):
    pl = await db.playlists.find_one({"active": True}, P)
    if not pl or not pl["items"]:
        return None, state
    if state.get("playlist_id") != pl["id"]:
        state["playlist_id"], state["pos"] = pl["id"], 0
    genres = []
    for dp in rules.get("dayparts") or []:
        if int(dp.get("start_hour", 0)) <= dt.hour < int(dp.get("end_hour", 24)) and dp.get("genres"):
            genres = dp["genres"]
            break
    items = pl["items"]
    n = len(items)
    tracks = {t["id"]: t for t in await db.tracks.find({"id": {"$in": items}, "status": "ativa"}, P).to_list(50000)}
    recent_ids = state.get("recent_tracks", [])
    fallback = None
    for step in range(n):
        idx = (state.get("pos", 0) + step) % n
        t = tracks.get(items[idx])
        if not t:
            continue
        if genres and t.get("genre") not in genres:
            fallback = fallback or (idx, t)
            continue
        if t["id"] in recent_ids and n > len(recent_ids) + 1:
            continue
        state["pos"] = idx + 1
        return t, state
    if fallback:
        state["pos"] = fallback[0] + 1
        return fallback[1], state
    return None, state


async def advance(business_id):
    dt = local_now()
    rules = await get_rules(business_id)
    state = await db.radio_states.find_one({"business_id": business_id}, P) or \
        {"business_id": business_id, "pos": 0, "songs_since_break": 0, "ad_queue": [], "recent_tracks": []}
    item = None
    while state.get("ad_queue") and not item:
        aid = state["ad_queue"].pop(0)
        ad = await db.ads.find_one({"id": aid, "business_id": {"$in": [business_id, None]}}, P)
        if ad and ad_is_eligible(ad, dt) and not rules["ads_paused"]:
            item = ("ad", ad)
    if not item and break_due(state, rules, dt):
        ads = await pick_break(business_id, rules, dt)
        state["songs_since_break"] = 0
        state["last_break_at"] = now_iso()
        if ads:
            state["ad_queue"] = [a["id"] for a in ads[1:]]
            item = ("ad", ads[0])
    if not item:
        t, state = await next_track(state, rules, dt)
        if t:
            item = ("music", t)
            state["songs_since_break"] = state.get("songs_since_break", 0) + 1
            state["recent_tracks"] = ([t["id"]] + state.get("recent_tracks", []))[:20]
    if not item:
        state["current"] = None
        await db.radio_states.replace_one({"business_id": business_id}, state, upsert=True)
        return None
    kind, doc = item
    if kind == "ad":
        out = {"type": "ad", "id": doc["id"], "title": doc["title"], "artist": doc.get("business_name", ""),
               "duration": doc.get("duration", 0), "media_url": media_url(doc["audio_file_id"]), "cover_url": None,
               "category_id": doc.get("category_id")}
        await db.ads.update_one({"id": doc["id"]}, {"$inc": {"play_count": 1}, "$set": {"last_played_at": now_iso()}})
    else:
        out = {"type": "music", "id": doc["id"], "title": doc["title"], "artist": doc.get("artist", ""),
               "duration": doc.get("duration", 0), "media_url": media_url(doc["file_id"]),
               "cover_url": media_url(doc.get("cover_file_id")), "genre": doc.get("genre")}
        await db.tracks.update_one({"id": doc["id"]}, {"$inc": {"play_count": 1}, "$set": {"last_played_at": now_iso()}})
    hid = new_id()
    out["history_id"] = hid
    out["started_at"] = now_iso()
    await db.playback_history.insert_one({"id": hid, "business_id": business_id, "type": out["type"],
                                          "ref_id": out["id"], "title": out["title"], "artist": out["artist"],
                                          "duration": out["duration"], "started_at": out["started_at"],
                                          "date": dt.date().isoformat()})
    state["current"] = out
    state["updated_at"] = now_iso()
    await db.radio_states.replace_one({"business_id": business_id}, state, upsert=True)
    return out


async def resolve_business(user, business_id: str | None):
    if user["role"] == ROLE_CLIENT:
        bid = user.get("business_id")
        ok, sub, reason = await subscription_access(bid)
        if not ok:
            raise HTTPException(402, reason)
        return bid
    if not business_id:
        raise HTTPException(400, "Selecione o estabelecimento para ouvir a rádio")
    return business_id


@router.post("/radio/next")
async def radio_next(business_id: str | None = None, user=Depends(get_current_user)):
    bid = await resolve_business(user, business_id)
    item = await advance(bid)
    if not item:
        raise HTTPException(409, "Programação vazia: nenhuma música ativa na playlist. Contate a MarkImagem.")
    return item


@router.get("/radio/status")
async def radio_status(business_id: str | None = None, user=Depends(get_current_user)):
    bid = user.get("business_id") if user["role"] == ROLE_CLIENT else business_id
    if not bid:
        raise HTTPException(400, "Estabelecimento não informado")
    ok, sub, reason = await subscription_access(bid)
    state = await db.radio_states.find_one({"business_id": bid}, P) or {}
    cur = state.get("current")
    on_air = bool(cur and cur.get("started_at") and datetime.fromisoformat(cur["started_at"]) +
                  timedelta(seconds=float(cur.get("duration") or 0) + 60) > now())
    pl = await db.playlists.find_one({"active": True}, {"_id": 0, "items": 0})
    return {"allowed": ok, "reason": reason, "subscription_status": (sub or {}).get("status"), "on_air": on_air,
            "current": cur if on_air else None, "playlist": pl}


class EventIn(BaseModel):
    type: str
    message: str = ""
    business_id: str | None = None


@router.post("/radio/event")
async def radio_event(body: EventIn, user=Depends(get_current_user)):
    bid = user.get("business_id") or body.business_id
    await db.stream_events.insert_one({"id": new_id(), "business_id": bid, "type": body.type[:40],
                                       "message": body.message[:500], "user_id": user["id"], "created_at": now_iso()})
    return {"ok": True}


@router.get("/media/{file_id}")
async def media(file_id: str, request: Request, user=Depends(get_current_user)):
    f = await db.files.find_one({"id": file_id, "is_deleted": False}, P)
    if not f:
        raise HTTPException(404, "Arquivo não encontrado")
    if user["role"] == ROLE_CLIENT:
        own = f.get("business_id") and f["business_id"] == user.get("business_id")
        shared = not f.get("business_id") and f["kind"] in ("music", "cover", "ad_audio")
        if not (own or shared):
            raise HTTPException(403, "Acesso negado")
    try:
        data, ct = await read_file(f)
    except Exception as e:
        await log_error("media", f"{file_id}: {e}")
        raise HTTPException(503, "Arquivo temporariamente indisponível")
    size = len(data)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        s, _, e = rng[6:].partition("-")
        start = int(s) if s else 0
        end = min(int(e) if e else size - 1, size - 1)
        if start >= size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(data[start:end + 1], status_code=206, media_type=ct, headers=headers)
    return Response(data, media_type=ct, headers=headers)


@router.get("/client/history")
async def client_history(type: str = "", date_from: str = "", date_to: str = "",
                         user=Depends(require_roles(ROLE_CLIENT))):
    q = {"business_id": user["business_id"]}
    if type:
        q["type"] = type
    if date_from or date_to:
        q["date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    return await db.playback_history.find(q, P).sort("started_at", -1).to_list(500)


@router.get("/admin/playback")
async def admin_history(business_id: str = "", type: str = "", user=Depends(require_roles(*STAFF))):
    q = {k: v for k, v in {"business_id": business_id, "type": type}.items() if v}
    return await db.playback_history.find(q, P).sort("started_at", -1).to_list(500)


@router.get("/admin/programming/rules")
async def get_global_rules(business_id: str = "", user=Depends(require_roles(*STAFF))):
    if business_id:
        o = await db.programming_rules.find_one({"scope": "business", "business_id": business_id}, P)
        return o or {**DEFAULT_RULES, "enabled": False, "scope": "business", "business_id": business_id}
    return await db.programming_rules.find_one({"scope": "global"}, P) or {**DEFAULT_RULES, "scope": "global"}


@router.put("/admin/programming/rules")
async def put_rules(body: dict, business_id: str = "", user=Depends(require_roles(ROLE_SUPER))):
    clean = {k: body[k] for k in RULE_KEYS if k in body}
    if clean.get("mode") not in (None, "every_n", "time", "custom"):
        raise HTTPException(400, "Modo inválido")
    for k in ("every_n", "every_minutes", "ads_per_break", "max_break_seconds", "max_ad_seconds_per_hour",
              "max_repeats_per_hour", "peak_ads_per_break"):
        if k in clean and (not isinstance(clean[k], (int, float)) or clean[k] < 0):
            raise HTTPException(400, f"Valor inválido para {k}")
    q = {"scope": "business", "business_id": business_id} if business_id else {"scope": "global"}
    await db.programming_rules.update_one(q, {"$set": {**clean, **q, "updated_at": now_iso()}}, upsert=True)
    await audit(user, "rules_update", "programming_rules", business_id or "global", clean)
    return await db.programming_rules.find_one(q, P)
