import io
import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import (db, now_iso, new_id, today_str, require_roles, get_current_user, client_business, STAFF,
                  AD_STATUSES, AD_PLAYABLE, store_file, read_file, audit, notify, get_settings, log_error,
                  ROLE_CLIENT)
from tts import synthesize, record_usage, voice_options, estimate_duration, mp3_duration, normalize_text

router = APIRouter()
staff = require_roles(*STAFF)
P = {"_id": 0}
VERSIONED = ("title", "text", "category_id", "start_date", "end_date", "days", "hour_start", "hour_end",
             "frequency_per_hour", "priority")


class AdIn(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    business_id: str | None = None
    category_id: str | None = None
    text: str = Field(default="", max_length=4000)
    start_date: str | None = None
    end_date: str | None = None
    days: list[int] = []
    hour_start: str | None = None
    hour_end: str | None = None
    frequency_per_hour: int = Field(default=2, ge=0, le=30)
    priority: int = Field(default=3, ge=1, le=5)
    voice: str | None = None
    style: str | None = None


class AdPatch(BaseModel):
    title: str | None = None
    business_id: str | None = None
    category_id: str | None = None
    text: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    days: list[int] | None = None
    hour_start: str | None = None
    hour_end: str | None = None
    frequency_per_hour: int | None = None
    priority: int | None = None
    reason: str = ""


class StatusIn(BaseModel):
    status: str
    reason: str = ""


class GenIn(BaseModel):
    voice: str
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    pause: float = Field(default=0.4, ge=0, le=3)
    stability: float = Field(default=0.5, ge=0, le=1)
    style: float = Field(default=0.2, ge=0, le=1)
    pronunciations: list[dict] = []
    speak_prices: bool = True
    speak_dates: bool = True


class CopyIn(BaseModel):
    style: str = "Oferta urgente"
    business_name: str = ""
    products: str = Field(default="", max_length=2000)
    extra: str = Field(default="", max_length=1000)
    duration_s: int = Field(default=30, ge=10, le=90)


def validate_dates(start, end):
    if start and end and end < start:
        raise HTTPException(400, "A data de validade deve ser posterior à data de início")


async def biz_name(bid):
    if not bid:
        return "Todas as rádios (institucional)"
    b = await db.businesses.find_one({"id": bid}, P)
    if not b:
        raise HTTPException(400, "Cliente não encontrado")
    return b["name"]


async def plan_of(bid):
    sub = await db.subscriptions.find_one({"business_id": bid}, P, sort=[("created_at", -1)])
    return (await db.plans.find_one({"id": sub["plan_id"]}, P)) if sub else None


def publish_status(ad):
    return "agendado" if ad.get("start_date") and ad["start_date"] > today_str() else "em_veiculacao"


async def add_version(ad_before, ad_after, user, reason):
    n = await db.ad_versions.count_documents({"ad_id": ad_after["id"]})
    await db.ad_versions.insert_one({"id": new_id(), "ad_id": ad_after["id"], "version": n + 1,
                                     "before": {k: ad_before.get(k) for k in VERSIONED + ("audio_file_id",)},
                                     "after": {k: ad_after.get(k) for k in VERSIONED + ("audio_file_id",)},
                                     "reason": reason, "changed_by": user.get("email"), "created_at": now_iso()})


def hist(status, user, note=""):
    return {"status": status, "by": user.get("email", "sistema"), "note": note, "at": now_iso()}


# ---------------- ads (staff) ----------------
@router.get("/admin/ads")
async def list_ads(status: str = "", business_id: str = "", category_id: str = "", user=Depends(staff)):
    q = {}
    if status:
        q["status"] = status
    if business_id:
        q["business_id"] = None if business_id == "global" else business_id
    if category_id:
        q["category_id"] = category_id
    return await db.ads.find(q, P).sort("created_at", -1).to_list(2000)


@router.post("/admin/ads")
async def create_ad(body: AdIn, user=Depends(staff)):
    validate_dates(body.start_date, body.end_date)
    ad = {**body.model_dump(), "id": new_id(), "business_name": await biz_name(body.business_id),
          "status": "rascunho", "audio_file_id": None, "audio_source": None, "duration": 0,
          "estimated_duration": estimate_duration(body.text), "approved_by": None, "approved_at": None,
          "client_approval_required": False, "client_approved_at": None, "auto_publish": False, "play_count": 0,
          "request_id": None, "expiry_alerted": False, "created_by": user["email"], "created_at": now_iso(),
          "updated_at": now_iso(), "history": [hist("rascunho", user, "Criado")]}
    if body.business_id:
        plan = await plan_of(body.business_id)
        ad["client_approval_required"] = bool(plan and plan.get("client_preview_approval"))
    await db.ads.insert_one(dict(ad))
    await audit(user, "ad_create", "ad", ad["id"], business_id=body.business_id)
    ad.pop("_id", None)
    return ad


@router.get("/admin/ads/{aid}")
async def get_ad(aid: str, user=Depends(staff)):
    ad = await db.ads.find_one({"id": aid}, P)
    if not ad:
        raise HTTPException(404, "Anúncio não encontrado")
    versions = await db.ad_versions.find({"ad_id": aid}, P).sort("version", -1).to_list(200)
    gens = await db.generated_audio.find({"ad_id": aid}, P).sort("created_at", -1).to_list(50)
    return {"ad": ad, "versions": versions, "generations": gens}


async def apply_patch(ad, upd, user, reason):
    validate_dates(upd.get("start_date", ad.get("start_date")), upd.get("end_date", ad.get("end_date")))
    after = {**ad, **upd}
    if "text" in upd and upd["text"] != ad.get("text"):
        after.update({"audio_file_id": None, "audio_source": None, "duration": 0, "client_approved_at": None,
                      "estimated_duration": estimate_duration(upd["text"])})
        if ad["status"] in AD_PLAYABLE:
            after["status"] = "rascunho"
            after["history"] = ad.get("history", []) + [hist("rascunho", user, "Texto alterado: áudio anterior "
                                                                               "retirado da veiculação")]
    if "end_date" in upd and ad["status"] == "expirado" and upd["end_date"] >= today_str():
        after["status"] = publish_status(after) if after.get("audio_file_id") else "rascunho"
        after["expiry_alerted"] = False
        after["history"] = after.get("history", ad.get("history", [])) + [hist(after["status"], user, "Renovado")]
    after["updated_at"] = now_iso()
    after.pop("_id", None)
    await db.ads.replace_one({"id": ad["id"]}, after)
    await add_version(ad, after, user, reason or "Edição")
    return after


@router.patch("/admin/ads/{aid}")
async def patch_ad(aid: str, body: AdPatch, user=Depends(staff)):
    ad = await db.ads.find_one({"id": aid}, P)
    if not ad:
        raise HTTPException(404, "Anúncio não encontrado")
    upd = {k: v for k, v in body.model_dump(exclude={"reason"}).items() if v is not None}
    if "business_id" in upd:
        upd["business_name"] = await biz_name(upd["business_id"] or None)
        upd["business_id"] = upd["business_id"] or None
    after = await apply_patch(ad, upd, user, body.reason)
    await audit(user, "ad_update", "ad", aid, {"fields": list(upd)}, business_id=ad.get("business_id"))
    return after


@router.post("/admin/ads/{aid}/status")
async def change_status(aid: str, body: StatusIn, user=Depends(staff)):
    ad = await db.ads.find_one({"id": aid}, P)
    if not ad:
        raise HTTPException(404, "Anúncio não encontrado")
    st = body.status
    if st == "publicar":
        st = publish_status(ad)
    if st not in AD_STATUSES:
        raise HTTPException(400, "Status inválido")
    upd = {"status": st, "updated_at": now_iso()}
    if st in AD_PLAYABLE:
        if not ad.get("audio_file_id"):
            raise HTTPException(400, "Gere ou envie o áudio antes de aprovar/publicar")
        if ad.get("end_date") and ad["end_date"] < today_str():
            raise HTTPException(400, "Anúncio vencido: renove a data de validade antes de publicar")
        if st != "aprovado" and ad.get("client_approval_required") and not ad.get("client_approved_at"):
            raise HTTPException(400, "Aguardando aprovação da prévia pelo cliente")
        if ad.get("business_id") and ad["status"] not in AD_PLAYABLE:
            plan = await plan_of(ad["business_id"])
            limit = (plan or {}).get("max_active_ads") or 0
            if limit and await db.ads.count_documents({"business_id": ad["business_id"],
                                                       "status": {"$in": list(AD_PLAYABLE)}}) >= limit:
                raise HTTPException(400, f"Limite de {limit} anúncios ativos do plano atingido")
        if not ad.get("approved_by"):
            upd.update({"approved_by": user["email"], "approved_at": now_iso()})
    await db.ads.update_one({"id": aid}, {"$set": upd, "$push": {"history": hist(st, user, body.reason)}})
    await audit(user, "ad_status", "ad", aid, {"from": ad["status"], "to": st}, business_id=ad.get("business_id"))
    if ad.get("business_id") and st in ("em_veiculacao", "agendado", "rejeitado"):
        label = {"em_veiculacao": "está no ar", "agendado": "foi agendado", "rejeitado": "foi rejeitado"}[st]
        await notify(f"Anúncio {label}", f"'{ad['title']}' {label}. {body.reason}".strip(),
                     business_id=ad["business_id"], link="/cliente/anuncios")
    return await db.ads.find_one({"id": aid}, P)


@router.post("/admin/ads/{aid}/generate")
async def generate_audio(aid: str, body: GenIn, user=Depends(staff)):
    ad = await db.ads.find_one({"id": aid}, P)
    if not ad:
        raise HTTPException(404, "Anúncio não encontrado")
    if not ad.get("text", "").strip():
        raise HTTPException(400, "Informe o texto do anúncio")
    s = await get_settings()
    if ad.get("business_id"):
        month = datetime.now().strftime("%Y-%m")
        used = sum(u.get("chars", 0) for u in await db.tts_usage.find({"business_id": ad["business_id"], "month": month},
                                                                       P).to_list(100000))
        if used + len(ad["text"]) > int(s["tts_monthly_char_limit_per_client"]):
            raise HTTPException(400, "Limite mensal de caracteres de geração de voz do cliente atingido")
    try:
        res = await synthesize(ad["text"], body.voice, body.speed, body.pause, body.stability, body.style,
                               body.pronunciations, body.speak_prices, body.speak_dates)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        await log_error("tts", str(e), {"ad_id": aid}, ad.get("business_id"))
        raise HTTPException(502, "Falha no serviço de voz. Tente novamente em instantes.")
    f = await store_file("ad_audio", res["audio"], "audio/mpeg", "mp3", f"{ad['title']}.mp3", ad.get("business_id"),
                         user["id"])
    dur = mp3_duration(res["audio"])
    gen = {"id": new_id(), "ad_id": aid, "business_id": ad.get("business_id"), "file_id": f["id"],
           "provider": res["provider"], "provisional": res["provisional"], "voice": body.voice,
           "params": body.model_dump(), "text": ad["text"], "final_text": res["final_text"], "chars": res["chars"],
           "cost_usd": res["cost_usd"], "duration": dur, "created_by": user["email"], "created_at": now_iso()}
    await db.generated_audio.insert_one(dict(gen))
    await record_usage(ad.get("business_id"), res["provider"], res["chars"], res["cost_usd"], aid, user)
    before = dict(ad)
    upd = {"audio_file_id": f["id"], "audio_source": "tts", "duration": dur, "voice": body.voice,
           "tts_params": body.model_dump(), "audio_provisional": res["provisional"], "client_approved_at": None,
           "updated_at": now_iso()}
    if ad["status"] in AD_PLAYABLE:
        upd["status"] = "aguardando_aprovacao"
    await db.ads.update_one({"id": aid}, {"$set": upd})
    await add_version(before, {**ad, **upd}, user, "Áudio gerado")
    gen.pop("_id", None)
    return {"generation": gen, "ad": await db.ads.find_one({"id": aid}, P)}


@router.post("/admin/ads/{aid}/upload-audio")
async def upload_ad_audio(aid: str, file: UploadFile = File(...), user=Depends(staff)):
    ad = await db.ads.find_one({"id": aid}, P)
    if not ad:
        raise HTTPException(404, "Anúncio não encontrado")
    data = await file.read()
    dur = mp3_duration(data)
    if not (file.filename or "").lower().endswith(".mp3") or dur <= 0:
        raise HTTPException(400, "Envie um arquivo MP3 válido")
    f = await store_file("ad_audio", data, "audio/mpeg", "mp3", file.filename, ad.get("business_id"), user["id"])
    upd = {"audio_file_id": f["id"], "audio_source": "upload", "duration": dur, "audio_provisional": False,
           "updated_at": now_iso()}
    await db.ads.update_one({"id": aid}, {"$set": upd})
    await add_version(ad, {**ad, **upd}, user, "Áudio enviado")
    return await db.ads.find_one({"id": aid}, P)


@router.get("/admin/tts/voices")
async def voices(user=Depends(staff)):
    s = await get_settings()
    return {"voices": await voice_options(), "default": s["default_voice"],
            "elevenlabs_configured": bool(s["elevenlabs_api_key"])}


class PreviewIn(BaseModel):
    text: str
    pronunciations: list[dict] = []


@router.post("/admin/tts/normalize")
async def normalize_preview(body: PreviewIn, user=Depends(staff)):
    t = normalize_text(body.text, body.pronunciations)
    return {"text": t, "estimated_duration": estimate_duration(t)}


@router.post("/admin/ai/copy")
async def ai_copy(body: CopyIn, user=Depends(staff)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
    words = int(body.duration_s * 2.5)
    system = ("Você é redator publicitário de rádio de varejo no Brasil. Escreva textos curtos, claros, em português "
              "do Brasil, prontos para locução em loja, sem emojis, sem hashtags, sem marcações, sem títulos. "
              "Preços no formato R$ 00,00. Responda somente com o texto do anúncio.")
    prompt = (f"Estilo de locução: {body.style}.\nEstabelecimento: {body.business_name or 'a loja'}.\n"
              f"Produtos/ofertas: {body.products or 'ofertas da semana'}.\nObservações: {body.extra or '-'}.\n"
              f"Tamanho: cerca de {words} palavras (~{body.duration_s} segundos).")
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"copy-{new_id()}",
                   system_message=system).with_model("anthropic", "claude-sonnet-5-5")

    async def gen():
        try:
            async for ev in chat.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    yield f"data: {json.dumps({'t': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            yield "data: [DONE]\n\n"
        except Exception as e:
            await log_error("ai_copy", str(e))
            yield f"data: {json.dumps({'error': 'Falha ao gerar texto. Tente novamente.'})}\n\n"
    await record_usage(None, "anthropic:claude-sonnet-5-5", len(prompt), 0.0, None, user, kind="copy")
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------- voice profiles ----------------
class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    consent: bool
    consent_text: str = Field(min_length=10)


@router.get("/admin/voice/profiles")
async def profiles(user=Depends(staff)):
    out = await db.voice_profiles.find({"deleted": {"$ne": True}}, P).sort("created_at", -1).to_list(50)
    for p in out:
        p["recordings"] = await db.voice_recordings.find({"profile_id": p["id"], "deleted": {"$ne": True}},
                                                         P).to_list(50)
    return out


@router.post("/admin/voice/profiles")
async def create_profile(body: ProfileIn, user=Depends(staff)):
    if not body.consent:
        raise HTTPException(400, "A autorização explícita é obrigatória para criar o modelo de voz")
    p = {"id": new_id(), "name": body.name, "provider": "elevenlabs", "elevenlabs_voice_id": None,
         "status": "sem_amostras", "consent": {"accepted": True, "by": user["email"], "at": now_iso(),
                                               "text": body.consent_text},
         "created_by": user["email"], "created_at": now_iso()}
    await db.voice_profiles.insert_one(dict(p))
    await audit(user, "voice_consent", "voice_profile", p["id"], {"text": body.consent_text})
    p.pop("_id", None)
    return p


@router.post("/admin/voice/profiles/{pid}/recordings")
async def add_recording(pid: str, file: UploadFile = File(...), label: str = Form(""), user=Depends(staff)):
    prof = await db.voice_profiles.find_one({"id": pid, "deleted": {"$ne": True}}, P)
    if not prof:
        raise HTTPException(404, "Perfil não encontrado")
    data = await file.read()
    ct = (file.content_type or "").split(";")[0]
    exts = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
            "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac"}
    if ct not in exts or len(data) < 2000 or len(data) > 25 * 1024 * 1024:
        raise HTTPException(400, "Envie áudio válido (WEBM, MP3, WAV, M4A ou OGG, até 25 MB)")
    f = await store_file("voice", data, ct, exts[ct], file.filename or "gravacao", None, user["id"])
    rec = {"id": new_id(), "profile_id": pid, "file_id": f["id"], "label": label or file.filename or "Gravação",
           "size": len(data), "content_type": ct, "created_at": now_iso()}
    await db.voice_recordings.insert_one(dict(rec))
    if prof["status"] == "sem_amostras":
        await db.voice_profiles.update_one({"id": pid}, {"$set": {"status": "pronto_para_clonar"}})
    await audit(user, "voice_recording_add", "voice_recording", rec["id"])
    rec.pop("_id", None)
    return rec


@router.delete("/admin/voice/recordings/{rid}")
async def delete_recording(rid: str, user=Depends(staff)):
    rec = await db.voice_recordings.find_one({"id": rid}, P)
    if not rec:
        raise HTTPException(404, "Gravação não encontrada")
    await db.voice_recordings.update_one({"id": rid}, {"$set": {"deleted": True}})
    await db.files.update_one({"id": rec["file_id"]}, {"$set": {"is_deleted": True}})
    await audit(user, "voice_recording_delete", "voice_recording", rid)
    return {"ok": True}


@router.post("/admin/voice/profiles/{pid}/clone")
async def clone_voice(pid: str, user=Depends(staff)):
    prof = await db.voice_profiles.find_one({"id": pid, "deleted": {"$ne": True}}, P)
    if not prof:
        raise HTTPException(404, "Perfil não encontrado")
    s = await get_settings(secrets=True)
    if not s["elevenlabs_api_key"]:
        raise HTTPException(400, "Serviço de clonagem NÃO configurado. Informe a chave ElevenLabs em Configurações. "
                                 "Enquanto isso, use a voz PROVISÓRIA genérica (identificada como tal).")
    recs = await db.voice_recordings.find({"profile_id": pid, "deleted": {"$ne": True}}, P).to_list(25)
    if not recs:
        raise HTTPException(400, "Envie ao menos uma amostra de voz (recomendado: 1 a 3 minutos no total)")
    files = []
    for r in recs:
        fdoc = await db.files.find_one({"id": r["file_id"]}, P)
        data, ct = await read_file(fdoc)
        files.append((f"{r['id']}.{fdoc['path'].rsplit('.', 1)[-1]}", io.BytesIO(data), ct))
    try:
        from elevenlabs.client import AsyncElevenLabs
        cli = AsyncElevenLabs(api_key=s["elevenlabs_api_key"], timeout=120)
        voice = await cli.voices.ivc.create(name=f"MarkImagem - {prof['name']}", files=files,
                                            description="Voz oficial MarkImagem (autorizada pelo titular)")
    except Exception as e:
        await log_error("voice_clone", str(e))
        await db.voice_profiles.update_one({"id": pid}, {"$set": {"status": "erro", "last_error": str(e)[:300]}})
        raise HTTPException(502, f"Falha ao criar voz clonada: {str(e)[:200]}")
    await db.voice_profiles.update_one({"id": pid}, {"$set": {"elevenlabs_voice_id": voice.voice_id,
                                                              "status": "clonada", "cloned_at": now_iso()}})
    await audit(user, "voice_clone", "voice_profile", pid)
    return await db.voice_profiles.find_one({"id": pid}, P)


@router.delete("/admin/voice/profiles/{pid}")
async def delete_profile(pid: str, user=Depends(staff)):
    prof = await db.voice_profiles.find_one({"id": pid}, P)
    if not prof:
        raise HTTPException(404, "Perfil não encontrado")
    s = await get_settings(secrets=True)
    if prof.get("elevenlabs_voice_id") and s["elevenlabs_api_key"]:
        try:
            from elevenlabs.client import AsyncElevenLabs
            await AsyncElevenLabs(api_key=s["elevenlabs_api_key"]).voices.delete(prof["elevenlabs_voice_id"])
        except Exception as e:
            await log_error("voice_delete", str(e))
    await db.voice_profiles.update_one({"id": pid}, {"$set": {"deleted": True, "elevenlabs_voice_id": None}})
    await db.voice_recordings.update_many({"profile_id": pid}, {"$set": {"deleted": True}})
    await audit(user, "voice_profile_delete", "voice_profile", pid)
    return {"ok": True}


class VoiceTestIn(BaseModel):
    voice: str
    text: str = Field(default="Atenção, clientes! Esta é a voz oficial da MarkImagem Rádio Web.", max_length=400)
    speed: float = 1.0


@router.post("/admin/voice/test")
async def voice_test(body: VoiceTestIn, user=Depends(staff)):
    try:
        res = await synthesize(body.text, body.voice, body.speed)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        await log_error("tts_test", str(e))
        raise HTTPException(502, "Falha no serviço de voz")
    f = await store_file("voice_test", res["audio"], "audio/mpeg", "mp3", "teste.mp3", None, user["id"])
    await record_usage(None, res["provider"], res["chars"], res["cost_usd"], None, user, kind="test")
    return {"file_id": f["id"], "provisional": res["provisional"], "provider": res["provider"]}


# ---------------- client requests ----------------
class RequestIn(BaseModel):
    type: str = Field(pattern="^(novo|atualizacao|renovacao|suporte)$")
    title: str = Field(min_length=2, max_length=160)
    category_id: str | None = None
    text: str = Field(default="", max_length=4000)
    products: str = Field(default="", max_length=3000)
    start_date: str | None = None
    end_date: str | None = None
    ad_id: str | None = None
    attachments: list[str] = []


@router.post("/client/requests")
async def create_request(body: RequestIn, user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    validate_dates(body.start_date, body.end_date)
    plan = await plan_of(biz["id"])
    if body.type != "suporte":
        if not plan:
            raise HTTPException(400, "Contrate um plano para solicitar anúncios")
        month_start = datetime.now().strftime("%Y-%m")
        n = await db.ad_requests.count_documents({"business_id": biz["id"], "type": {"$ne": "suporte"},
                                                  "created_at": {"$regex": f"^{month_start}"}})
        if plan.get("max_requests_month") and n >= plan["max_requests_month"]:
            raise HTTPException(400, f"Limite mensal de {plan['max_requests_month']} solicitações do plano atingido")
        if body.type == "atualizacao" and not plan.get("can_request_updates", True):
            raise HTTPException(400, "Seu plano não permite solicitar atualizações")
        if body.attachments and not plan.get("allow_attachments"):
            raise HTTPException(400, "Seu plano não permite anexos")
    if body.ad_id and not await db.ads.find_one({"id": body.ad_id, "business_id": biz["id"]}):
        raise HTTPException(404, "Anúncio não encontrado")
    for fid in body.attachments:
        if not await db.files.find_one({"id": fid, "business_id": biz["id"]}):
            raise HTTPException(400, "Anexo inválido")
    req = {**body.model_dump(), "id": new_id(), "business_id": biz["id"], "business_name": biz["name"],
           "status": "recebida", "admin_notes": "", "resulting_ad_id": None, "created_by": user["email"],
           "created_at": now_iso(), "updated_at": now_iso(),
           "timeline": [{"status": "recebida", "at": now_iso(), "note": "Solicitação enviada"}]}
    await db.ad_requests.insert_one(dict(req))
    await notify("Nova solicitação de cliente", f"{biz['name']}: {body.title}", role=STAFF, link="/admin/solicitacoes")
    await audit(user, "request_create", "ad_request", req["id"], business_id=biz["id"])
    req.pop("_id", None)
    return req


@router.post("/client/requests/upload")
async def upload_attachment(file: UploadFile = File(...), user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Anexo maior que 10 MB")
    ct = (file.content_type or "application/octet-stream").split(";")[0]
    allowed = ("image/", "audio/", "application/pdf")
    if not ct.startswith(allowed):
        raise HTTPException(400, "Formato de anexo não permitido (imagem, áudio ou PDF)")
    ext = (file.filename or "arquivo.bin").rsplit(".", 1)[-1][:5]
    f = await store_file("attachment", data, ct, ext, file.filename, biz["id"], user["id"])
    return {"id": f["id"], "filename": f["filename"]}


@router.get("/client/requests")
async def my_requests(user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    return await db.ad_requests.find({"business_id": biz["id"]}, P).sort("created_at", -1).to_list(500)


@router.get("/client/ads")
async def my_ads(user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    ads = await db.ads.find({"business_id": biz["id"]}, {"_id": 0, "tts_params": 0}).sort("created_at", -1).to_list(500)
    return ads


@router.post("/client/ads/{aid}/approve-preview")
async def approve_preview(aid: str, user=Depends(require_roles(ROLE_CLIENT))):
    biz = await client_business(user)
    ad = await db.ads.find_one({"id": aid, "business_id": biz["id"]}, P)
    if not ad or not ad.get("audio_file_id"):
        raise HTTPException(404, "Prévia não disponível")
    await db.ads.update_one({"id": aid}, {"$set": {"client_approved_at": now_iso()},
                                          "$push": {"history": hist(ad["status"], user, "Prévia aprovada pelo cliente")}})
    await notify("Prévia aprovada pelo cliente", f"{biz['name']} aprovou '{ad['title']}'.", role=STAFF,
                 link="/admin/anuncios")
    return {"ok": True}


@router.get("/admin/requests")
async def all_requests(status: str = "", business_id: str = "", type: str = "", user=Depends(staff)):
    q = {k: v for k, v in {"status": status, "business_id": business_id, "type": type}.items() if v}
    return await db.ad_requests.find(q, P).sort("created_at", -1).to_list(2000)


class ReqPatch(BaseModel):
    status: str = Field(pattern="^(recebida|em_revisao|em_producao|concluida|rejeitada)$")
    admin_notes: str = ""


@router.patch("/admin/requests/{rid}")
async def update_request(rid: str, body: ReqPatch, user=Depends(staff)):
    req = await db.ad_requests.find_one({"id": rid}, P)
    if not req:
        raise HTTPException(404, "Solicitação não encontrada")
    await db.ad_requests.update_one({"id": rid}, {"$set": {"status": body.status, "admin_notes": body.admin_notes,
                                                           "updated_at": now_iso()},
                                                  "$push": {"timeline": {"status": body.status, "at": now_iso(),
                                                                         "note": body.admin_notes}}})
    await notify("Solicitação atualizada", f"'{req['title']}': {body.status.replace('_', ' ')}. {body.admin_notes}",
                 business_id=req["business_id"], link="/cliente/anuncios")
    await audit(user, "request_update", "ad_request", rid, {"status": body.status}, business_id=req["business_id"])
    return await db.ad_requests.find_one({"id": rid}, P)


@router.post("/admin/requests/{rid}/convert")
async def convert_request(rid: str, user=Depends(staff)):
    req = await db.ad_requests.find_one({"id": rid}, P)
    if not req or req["type"] == "suporte":
        raise HTTPException(400, "Solicitação inválida para conversão")
    plan = await plan_of(req["business_id"])
    text = req["text"] or ""
    if req.get("products"):
        text = (text + "\n" + req["products"]).strip() if req["type"] == "novo" else text
    if req["type"] == "novo":
        ad = await create_ad(AdIn(title=req["title"], business_id=req["business_id"], category_id=req["category_id"],
                                  text=text, start_date=req["start_date"], end_date=req["end_date"]), user)
        await db.ads.update_one({"id": ad["id"]}, {"$set": {
            "request_id": rid, "auto_publish": not (plan or {}).get("requires_approval", True)}})
        ad_id = ad["id"]
    else:
        ad = await db.ads.find_one({"id": req.get("ad_id"), "business_id": req["business_id"]}, P)
        if not ad:
            raise HTTPException(400, "Anúncio original não encontrado")
        upd = {}
        if req["type"] == "atualizacao" and req["text"]:
            upd["text"] = req["text"]
        if req.get("start_date"):
            upd["start_date"] = req["start_date"]
        if req.get("end_date"):
            upd["end_date"] = req["end_date"]
        await apply_patch(ad, upd, user, f"Solicitação do cliente ({req['type']})")
        ad_id = ad["id"]
    await db.ad_requests.update_one({"id": rid}, {"$set": {"status": "em_producao", "resulting_ad_id": ad_id,
                                                           "updated_at": now_iso()},
                                                  "$push": {"timeline": {"status": "em_producao", "at": now_iso(),
                                                                         "note": "Em produção do áudio"}}})
    await notify("Solicitação em produção", f"'{req['title']}' está em produção.", business_id=req["business_id"],
                 link="/cliente/anuncios")
    return await db.ads.find_one({"id": ad_id}, P)


# ---------------- categories ----------------
class CatIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    active: bool = True


@router.get("/categories")
async def categories(user=Depends(get_current_user)):
    return await db.ad_categories.find({}, P).sort("order", 1).to_list(500)


@router.post("/admin/categories")
async def create_cat(body: CatIn, user=Depends(staff)):
    c = {"id": new_id(), "name": body.name, "active": body.active, "order": 999, "created_at": now_iso()}
    await db.ad_categories.insert_one(dict(c))
    await audit(user, "category_create", "category", c["id"])
    c.pop("_id", None)
    return c


@router.patch("/admin/categories/{cid}")
async def patch_cat(cid: str, body: CatIn, user=Depends(staff)):
    await db.ad_categories.update_one({"id": cid}, {"$set": body.model_dump()})
    await audit(user, "category_update", "category", cid, body.model_dump())
    return await db.ad_categories.find_one({"id": cid}, P)


@router.delete("/admin/categories/{cid}")
async def delete_cat(cid: str, user=Depends(staff)):
    n = await db.ads.count_documents({"category_id": cid}) + await db.ad_requests.count_documents({"category_id": cid})
    if n:
        raise HTTPException(409, f"Categoria possui {n} registro(s) vinculados. Desative-a em vez de excluir.")
    await db.ad_categories.delete_one({"id": cid})
    await audit(user, "category_delete", "category", cid)
    return {"ok": True}
