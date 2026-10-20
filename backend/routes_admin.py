import csv
import hmac
import io
import json
import os
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field

from core import (db, now, now_iso, new_id, today_str, local_now, require_roles, get_current_user, client_business,
                  get_settings, save_settings, audit, notify, store_file, hash_password, ROLE_SUPER, ROLE_OPER,
                  ROLE_CLIENT, STAFF, AD_PLAYABLE, subscription_access, init_storage)
from routes_billing import subscription_maintenance

router = APIRouter()
P = {"_id": 0}
superadmin = require_roles(ROLE_SUPER)
staff = require_roles(*STAFF)


# ---------------- dashboard ----------------
@router.get("/admin/dashboard")
async def dashboard(user=Depends(staff)):
    month = local_now().strftime("%Y-%m")
    since30 = (now() - timedelta(days=30)).isoformat()
    subs = {s: await db.subscriptions.count_documents({"status": s}) for s in
            ("teste", "ativa", "pagamento_pendente", "inadimplente", "cancelamento_solicitado", "cancelada")}
    ads = {s: await db.ads.count_documents({"status": s}) for s in
           ("em_veiculacao", "agendado", "aguardando_aprovacao", "rascunho", "expirado", "pausado")}
    soon = (local_now().date() + timedelta(days=3)).isoformat()
    expiring = await db.ads.find({"status": {"$in": list(AD_PLAYABLE)}, "end_date": {"$gte": today_str(),
                                  "$lte": soon}}, P).to_list(20)
    pl = await db.playlists.find_one({"active": True}, {"_id": 0, "items": 0})
    s = await get_settings()
    storage_ok = True
    try:
        init_storage()
    except Exception:
        storage_ok = False
    out = {
        "clients_active": await db.businesses.count_documents({"status": "ativo"}),
        "clients_new_30d": await db.businesses.count_documents({"created_at": {"$gte": since30}}),
        "subscriptions": subs, "ads": ads, "expiring_ads": expiring,
        "tracks_total": await db.tracks.count_documents({"status": {"$ne": "excluida"}}),
        "tracks_active": await db.tracks.count_documents({"status": "ativa"}),
        "requests_pending": await db.ad_requests.count_documents({"status": {"$in": ["recebida", "em_revisao"]}}),
        "playlist": pl,
        "services": {"storage": storage_ok, "tts_provisional": True,
                     "voice_clone": bool(s["elevenlabs_api_key"]), "mercadopago": bool(s["mp_access_token"]),
                     "webhook_secret": bool(s["mp_webhook_secret"]), "email": bool(s["email_enabled"])},
        "recent_activity": await db.audit_logs.find({}, P).sort("created_at", -1).to_list(12),
        "stream_failures_24h": await db.stream_events.count_documents(
            {"type": "error", "created_at": {"$gte": (now() - timedelta(days=1)).isoformat()}}),
    }
    if user["role"] == ROLE_SUPER:
        mrr = 0.0
        async for sb in db.subscriptions.find({"status": {"$in": ["ativa", "cancelamento_solicitado"]}}, P):
            mrr += float(sb.get("amount") or 0) / max(1, int(sb.get("period_months") or 1))
        out["mrr"] = round(mrr, 2)
        out["payments_month"] = {st: await db.payments.count_documents({"status": st, "created_at": {
            "$regex": f"^{month}"}}) for st in ("aprovado", "recusado", "pendente")}
    return out


# ---------------- clients ----------------
class ClientIn(BaseModel):
    name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=8)
    business_name: str = Field(min_length=2)
    phone: str = ""
    segment: str = ""


@router.get("/admin/clients")
async def clients(q: str = "", user=Depends(staff)):
    query = {"name": {"$regex": q, "$options": "i"}} if q else {}
    bizs = await db.businesses.find(query, P).sort("created_at", -1).to_list(5000)
    for b in bizs:
        sub = await db.subscriptions.find_one({"business_id": b["id"]}, {"_id": 0, "history": 0},
                                              sort=[("created_at", -1)])
        b["subscription"] = sub if user["role"] == ROLE_SUPER else ({"status": sub["status"],
                                                                      "plan_name": sub["plan_name"]} if sub else None)
        owner = await db.users.find_one({"id": b.get("owner_user_id")}, {"_id": 0, "email": 1, "name": 1})
        b["owner"] = owner
        b["active_ads"] = await db.ads.count_documents({"business_id": b["id"], "status": {"$in": list(AD_PLAYABLE)}})
    return bizs


@router.post("/admin/clients")
async def create_client(body: ClientIn, user=Depends(superadmin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    uid, bid = new_id(), new_id()
    await db.businesses.insert_one({"id": bid, "name": body.business_name, "owner_user_id": uid, "phone": body.phone,
                                    "segment": body.segment, "address": "", "city": "", "state": "", "cnpj": "",
                                    "logo_file_id": None, "status": "ativo", "created_at": now_iso()})
    await db.users.insert_one({"id": uid, "email": email, "name": body.name, "role": ROLE_CLIENT, "business_id": bid,
                               "password_hash": hash_password(body.password), "active": True, "created_at": now_iso()})
    await audit(user, "client_create", "business", bid, business_id=bid)
    return {"id": bid}


@router.get("/admin/clients/{bid}")
async def client_detail(bid: str, user=Depends(staff)):
    b = await db.businesses.find_one({"id": bid}, P)
    if not b:
        raise HTTPException(404, "Cliente não encontrado")
    out = {"business": b, "users": await db.users.find({"business_id": bid}, {"_id": 0, "password_hash": 0}).to_list(50),
           "ads": await db.ads.find({"business_id": bid}, {"_id": 0, "history": 0}).sort("created_at", -1).to_list(200),
           "requests": await db.ad_requests.find({"business_id": bid}, P).sort("created_at", -1).to_list(100)}
    if user["role"] == ROLE_SUPER:
        out["subscriptions"] = await db.subscriptions.find({"business_id": bid}, P).sort("created_at", -1).to_list(50)
        out["payments"] = await db.payments.find({"business_id": bid}, P).sort("created_at", -1).to_list(200)
    ok, _s, reason = await subscription_access(bid)
    out["radio_access"] = {"allowed": ok, "reason": reason}
    return out


class ClientPatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(ativo|suspenso|inativo)$")
    notes: str | None = None
    name: str | None = None


@router.patch("/admin/clients/{bid}")
async def client_patch(bid: str, body: ClientPatch, user=Depends(superadmin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.businesses.update_one({"id": bid}, {"$set": upd})
    if "status" in upd:
        await db.users.update_many({"business_id": bid}, {"$set": {"active": upd["status"] == "ativo"}})
    await audit(user, "client_update", "business", bid, upd, business_id=bid)
    return await db.businesses.find_one({"id": bid}, P)


# ---------------- my business (client) ----------------
class BizIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    phone: str = Field(default="", max_length=30)
    segment: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=2)
    cnpj: str = Field(default="", max_length=20)


@router.get("/client/business")
async def my_business(user=Depends(require_roles(ROLE_CLIENT))):
    return await client_business(user)


@router.put("/client/business")
async def update_business(body: BizIn, user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    await db.businesses.update_one({"id": biz["id"]}, {"$set": {**body.model_dump(), "updated_at": now_iso()}})
    await audit(user, "business_update", "business", biz["id"], body.model_dump(), business_id=biz["id"])
    return await db.businesses.find_one({"id": biz["id"]}, P)


@router.post("/client/business/logo")
async def upload_logo(file: UploadFile = File(...), user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    data = await file.read()
    ct = (file.content_type or "").split(";")[0]
    if ct not in ("image/png", "image/jpeg", "image/webp") or len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Envie PNG, JPG ou WEBP de até 3 MB")
    f = await store_file("logo", data, ct, ct.split("/")[1], file.filename, biz["id"], user["id"])
    await db.businesses.update_one({"id": biz["id"]}, {"$set": {"logo_file_id": f["id"]}})
    return {"logo_file_id": f["id"]}


@router.get("/client/overview")
async def client_overview(user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    ok, sub, reason = await subscription_access(biz["id"])
    ads = await db.ads.find({"business_id": biz["id"], "status": {"$in": list(AD_PLAYABLE)}},
                            {"_id": 0, "history": 0, "tts_params": 0}).sort("end_date", 1).to_list(50)
    return {"business": biz, "subscription": sub, "radio_allowed": ok, "reason": reason, "active_ads": ads,
            "pending_requests": await db.ad_requests.count_documents({"business_id": biz["id"],
                                                                      "status": {"$in": ["recebida", "em_revisao",
                                                                                         "em_producao"]}})}


@router.get("/client/export")
async def export_my_data(user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    data = {"business": biz, "user": user,
            "ads": await db.ads.find({"business_id": biz["id"]}, P).to_list(2000),
            "requests": await db.ad_requests.find({"business_id": biz["id"]}, P).to_list(2000),
            "payments": await db.payments.find({"business_id": biz["id"]}, P).to_list(2000)}
    return Response(json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=meus-dados-markimagem.json"})


# ---------------- users ----------------
class UserIn(BaseModel):
    name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = Field(pattern="^(superadmin|operador)$")


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = Field(default=None, pattern="^(superadmin|operador)$")
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


@router.get("/admin/users")
async def users(user=Depends(superadmin)):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(5000)


@router.post("/admin/users")
async def create_user(body: UserIn, user=Depends(superadmin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    uid = new_id()
    await db.users.insert_one({"id": uid, "email": email, "name": body.name, "role": body.role, "active": True,
                               "password_hash": hash_password(body.password), "created_at": now_iso()})
    await audit(user, "user_create", "user", uid, {"role": body.role})
    return {"id": uid}


@router.patch("/admin/users/{uid}")
async def patch_user(uid: str, body: UserPatch, user=Depends(superadmin)):
    target = await db.users.find_one({"id": uid}, P)
    if not target:
        raise HTTPException(404, "Usuário não encontrado")
    upd = {k: v for k, v in body.model_dump().items() if v is not None and k != "password"}
    if target["role"] == ROLE_CLIENT:
        upd.pop("role", None)
    if uid == user["id"] and (upd.get("active") is False or upd.get("role") == ROLE_OPER):
        raise HTTPException(400, "Você não pode remover seu próprio acesso de superadministrador")
    if body.password:
        upd["password_hash"] = hash_password(body.password)
    await db.users.update_one({"id": uid}, {"$set": upd})
    await audit(user, "user_update", "user", uid, {k: v for k, v in upd.items() if k != "password_hash"})
    return {"ok": True}


# ---------------- settings ----------------
@router.get("/admin/settings")
async def settings(request: Request, user=Depends(superadmin)):
    s = await get_settings()
    s["webhook_url"] = f"{os.environ['FRONTEND_URL']}/api/billing/webhook"
    return s


@router.put("/admin/settings")
async def put_settings(body: dict, user=Depends(superadmin)):
    await save_settings(body)
    await audit(user, "settings_update", "system_settings", "general",
                {"keys": [k for k in body if not k.startswith("mp_access") and "secret" not in k and "api_key" not in k]})
    return await get_settings()


# ---------------- notifications ----------------
@router.get("/notifications")
async def my_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(50)
    return {"items": items, "unread": await db.notifications.count_documents({"user_id": user["id"], "read": False})}


@router.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ---------------- logs ----------------
@router.get("/admin/audit")
async def audit_logs(entity: str = "", user=Depends(superadmin)):
    q = {"entity": entity} if entity else {}
    return await db.audit_logs.find(q, P).sort("created_at", -1).to_list(500)


@router.get("/admin/errors")
async def error_logs(user=Depends(superadmin)):
    return {"errors": await db.error_logs.find({}, P).sort("created_at", -1).to_list(300),
            "stream": await db.stream_events.find({}, P).sort("created_at", -1).to_list(200)}


@router.get("/admin/backup")
async def backup(user=Depends(superadmin)):
    cols = ["users", "businesses", "plans", "subscriptions", "payments", "ads", "ad_versions", "ad_categories",
            "ad_requests", "voice_profiles", "voice_recordings", "tracks", "music_packages", "playlists",
            "programming_rules", "files", "system_settings"]
    data = {c: await db[c].find({}, {"_id": 0, "password_hash": 0}).to_list(100000) for c in cols}
    await audit(user, "backup_export", "system", None)
    return Response(json.dumps(data, ensure_ascii=False, default=str), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename=backup-markimagem-{today_str()}.json"})


# ---------------- reports ----------------
REPORTS = ("clientes", "receita", "assinaturas", "pagamentos", "anuncios_veiculados", "anuncios_expirados",
           "solicitacoes", "musicas", "transmissao", "falhas", "consumo_voz")


@router.get("/admin/reports/{kind}")
async def report(kind: str, date_from: str = "", date_to: str = "", business_id: str = "", plan_id: str = "",
                 category_id: str = "", status: str = "", format: str = "json", user=Depends(staff)):
    if kind not in REPORTS:
        raise HTTPException(404, "Relatório inexistente")
    if kind in ("receita", "assinaturas", "pagamentos", "consumo_voz") and user["role"] != ROLE_SUPER:
        raise HTTPException(403, "Relatório financeiro restrito ao superadministrador")
    rng = {k: v for k, v in (("$gte", date_from), ("$lte", date_to + "T23:59:59" if date_to else "")) if v}
    names = {b["id"]: b["name"] for b in await db.businesses.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    bq = {"business_id": business_id} if business_id else {}
    cols, rows = [], []
    if kind == "clientes":
        q = {**({"id": business_id} if business_id else {}), **({"created_at": rng} if rng else {})}
        cols = ["Estabelecimento", "Segmento", "Status", "Cadastro"]
        rows = [[b["name"], b.get("segment", ""), b["status"], b["created_at"][:10]]
                async for b in db.businesses.find(q, P)]
    elif kind in ("receita", "pagamentos"):
        q = {**bq, **({"created_at": rng} if rng else {}), **({"status": status} if status else {})}
        if kind == "receita":
            q["status"] = "aprovado"
            agg = {}
            async for p in db.payments.find(q, P):
                m = p["created_at"][:7]
                agg[m] = agg.get(m, 0) + float(p["amount"])
            cols, rows = ["Mês", "Receita (R$)"], [[m, round(v, 2)] for m, v in sorted(agg.items())]
        else:
            cols = ["Data", "Cliente", "Plano", "Valor (R$)", "Status", "Transação"]
            rows = [[p["created_at"][:10], names.get(p["business_id"], "-"), p.get("plan_name", ""), p["amount"],
                     p["status"], p.get("mp_payment_id") or p.get("mp_authorized_payment_id") or "-"]
                    async for p in db.payments.find(q, P).sort("created_at", -1)]
    elif kind == "assinaturas":
        q = {**bq, **({"plan_id": plan_id} if plan_id else {}), **({"status": status} if status else {}),
             **({"created_at": rng} if rng else {})}
        cols = ["Cliente", "Plano", "Valor (R$)", "Status", "Fim do período", "Criada em"]
        rows = [[names.get(s["business_id"], "-"), s["plan_name"], s["amount"], s["status"],
                 (s.get("current_period_end") or "")[:10], s["created_at"][:10]]
                async for s in db.subscriptions.find(q, P).sort("created_at", -1)]
    elif kind in ("anuncios_veiculados", "musicas", "transmissao"):
        q = {**bq, "type": "ad" if kind == "anuncios_veiculados" else "music", **({"started_at": rng} if rng else {})}
        if kind == "transmissao":
            q.pop("type")
        agg = {}
        async for h in db.playback_history.find(q, P):
            key = h["business_id"] if kind == "transmissao" else (h["business_id"], h["ref_id"])
            a = agg.setdefault(key, {"n": 0, "s": 0.0, "title": h["title"], "artist": h.get("artist", ""),
                                     "biz": names.get(h["business_id"], "-")})
            a["n"] += 1
            a["s"] += float(h.get("duration") or 0)
        if kind == "transmissao":
            cols = ["Cliente", "Itens reproduzidos", "Tempo total (h)"]
            rows = [[a["biz"], a["n"], round(a["s"] / 3600, 2)] for a in agg.values()]
        else:
            cols = ["Cliente", "Título", "Artista/Origem", "Execuções", "Tempo (min)"]
            rows = sorted([[a["biz"], a["title"], a["artist"], a["n"], round(a["s"] / 60, 1)] for a in agg.values()],
                          key=lambda r: -r[3])
    elif kind == "anuncios_expirados":
        q = {**bq, "status": "expirado", **({"category_id": category_id} if category_id else {})}
        cols = ["Cliente", "Anúncio", "Início", "Validade", "Execuções"]
        rows = [[a.get("business_name", ""), a["title"], a.get("start_date") or "", a.get("end_date") or "",
                 a.get("play_count", 0)] async for a in db.ads.find(q, P)]
    elif kind == "solicitacoes":
        q = {**bq, **({"status": status} if status else {}), **({"created_at": rng} if rng else {}),
             **({"category_id": category_id} if category_id else {})}
        cols = ["Data", "Cliente", "Tipo", "Título", "Status"]
        rows = [[r["created_at"][:10], r["business_name"], r["type"], r["title"], r["status"]]
                async for r in db.ad_requests.find(q, P).sort("created_at", -1)]
    elif kind == "falhas":
        q = {**bq, **({"created_at": rng} if rng else {})}
        cols = ["Data", "Cliente", "Tipo", "Mensagem"]
        rows = [[e["created_at"][:19], names.get(e.get("business_id"), "-"), e["type"], e["message"]]
                async for e in db.stream_events.find(q, P).sort("created_at", -1)]
    elif kind == "consumo_voz":
        q = {**bq, **({"created_at": rng} if rng else {})}
        agg = {}
        async for u in db.tts_usage.find(q, P):
            key = (u.get("business_id"), u["provider"], u.get("month"))
            a = agg.setdefault(key, [0, 0, 0.0])
            a[0] += 1
            a[1] += u["chars"]
            a[2] += u["cost_usd"]
        cols = ["Mês", "Cliente", "Serviço", "Gerações", "Caracteres", "Custo estimado (US$)"]
        rows = [[k[2], names.get(k[0], "Plataforma"), k[1], v[0], v[1], round(v[2], 4)] for k, v in agg.items()]
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(cols)
        w.writerows(rows)
        return Response("\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=relatorio-{kind}-{today_str()}.csv"})
    return {"columns": cols, "rows": rows}


# ---------------- maintenance (cron) ----------------
async def ad_maintenance():
    today = today_str()
    s = await get_settings()
    out = {"expired": 0, "started": 0, "alerts": 0}
    async for ad in db.ads.find({"status": {"$in": list(AD_PLAYABLE)}, "end_date": {"$lt": today, "$ne": None}},
                                P):
        await db.ads.update_one({"id": ad["id"]}, {"$set": {"status": "expirado", "updated_at": now_iso()},
                                                   "$push": {"history": {"status": "expirado", "by": "sistema",
                                                                         "note": "Validade encerrada", "at": now_iso()}}})
        out["expired"] += 1
        if ad.get("business_id"):
            await notify("Anúncio expirado", f"'{ad['title']}' saiu do ar por fim da validade. Solicite renovação.",
                         business_id=ad["business_id"], link="/cliente/anuncios", kind="warning")
    async for ad in db.ads.find({"status": {"$in": ["agendado", "aprovado"]}}, P):
        if not ad.get("start_date") or ad["start_date"] <= today:
            await db.ads.update_one({"id": ad["id"]}, {"$set": {"status": "em_veiculacao"},
                                                       "$push": {"history": {"status": "em_veiculacao", "by": "sistema",
                                                                             "note": "Início da veiculação",
                                                                             "at": now_iso()}}})
            out["started"] += 1
    limit = (local_now().date() + timedelta(days=int(s["expiry_alert_days"]))).isoformat()
    async for ad in db.ads.find({"status": {"$in": list(AD_PLAYABLE)}, "end_date": {"$gte": today, "$lte": limit},
                                 "expiry_alerted": {"$ne": True}}, P):
        msg = f"'{ad['title']}' vence em {ad['end_date'][8:10]}/{ad['end_date'][5:7]}."
        await notify("Anúncio próximo do vencimento", msg, role=STAFF, link="/admin/anuncios", kind="warning")
        if ad.get("business_id"):
            await notify("Seu anúncio vai vencer", msg + " Solicite a renovação se desejar.",
                         business_id=ad["business_id"], link="/cliente/anuncios", kind="warning")
        await db.ads.update_one({"id": ad["id"]}, {"$set": {"expiry_alerted": True}})
        out["alerts"] += 1
    return out


async def run_maintenance(run_id):
    res = {"ads": await ad_maintenance(), "subscriptions": await subscription_maintenance()}
    await db.cron_runs.update_one({"run_id": run_id}, {"$set": {"result": res, "finished_at": now_iso()}})
    return res


@router.post("/cron/tick")
async def cron_tick(request: Request, bg: BackgroundTasks):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], os.environ["WEBHOOK_CRON_SECRET"]):
        raise HTTPException(401, "Unauthorized")
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or (body or {}).get("run_id") or new_id()
    try:
        await db.cron_runs.insert_one({"run_id": run_id, "started_at": now_iso()})
    except Exception:
        return {"ok": True, "duplicate": True}
    bg.add_task(run_maintenance, run_id)
    return {"ok": True}


@router.post("/admin/maintenance/run")
async def manual_maintenance(user=Depends(superadmin)):
    run_id = f"manual-{new_id()}"
    await db.cron_runs.insert_one({"run_id": run_id, "started_at": now_iso()})
    return await run_maintenance(run_id)
