import os
import uuid
import base64
import hashlib
import logging
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

import bcrypt
import jwt
import requests
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]
logger = logging.getLogger("markimagem")
logging.basicConfig(level=logging.INFO)

APP_NAME = "markimagem-radio"
TZ = ZoneInfo("America/Sao_Paulo")
NOID = {"_id": 0}
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"

ROLE_SUPER = "superadmin"
ROLE_OPER = "operador"
ROLE_CLIENT = "cliente"
STAFF = (ROLE_SUPER, ROLE_OPER)

AD_STATUSES = ["rascunho", "aguardando_aprovacao", "aprovado", "agendado", "em_veiculacao",
               "pausado", "expirado", "rejeitado", "arquivado"]
AD_PLAYABLE = ("aprovado", "agendado", "em_veiculacao")
SUB_STATUSES = ["teste", "ativa", "pagamento_pendente", "inadimplente", "cancelamento_solicitado",
                "cancelada", "encerrada"]


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().isoformat()


def local_now():
    return datetime.now(TZ)


def today_str():
    return local_now().date().isoformat()


def new_id():
    return str(uuid.uuid4())


# ---------- auth ----------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(user_id: str, kind: str, minutes: int) -> str:
    payload = {"sub": user_id, "type": kind, "exp": now() + timedelta(minutes=minutes)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def set_auth_cookies(response, user_id: str):
    response.set_cookie("access_token", make_token(user_id, "access", 120), httponly=True, secure=True,
                        samesite="none", max_age=7200, path="/")
    response.set_cookie("refresh_token", make_token(user_id, "refresh", 60 * 24 * 7), httponly=True,
                        secure=True, samesite="none", max_age=604800, path="/")


def public_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k not in ("password_hash", "_id")}


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(401, "Não autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    if payload.get("type") != "access":
        raise HTTPException(401, "Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, NOID)
    if not user or not user.get("active", True):
        raise HTTPException(401, "Usuário inválido ou desativado")
    return public_user(user)


def require_roles(*roles):
    async def dep(request: Request):
        user = await get_current_user(request)
        if user["role"] not in roles:
            raise HTTPException(403, "Acesso negado para este perfil")
        return user
    return dep


async def client_business(user: dict) -> dict:
    if user["role"] != ROLE_CLIENT or not user.get("business_id"):
        raise HTTPException(403, "Disponível apenas para clientes assinantes")
    biz = await db.businesses.find_one({"id": user["business_id"]}, NOID)
    if not biz:
        raise HTTPException(404, "Estabelecimento não encontrado")
    return biz


# ---------- object storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_storage_key = None
_cache: "OrderedDict[str, tuple]" = OrderedDict()
_CACHE_MAX = 15


def init_storage(force=False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put(path, data, ct):
    for attempt in range(2):
        r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(attempt == 1),
                         "Content-Type": ct}, data=data, timeout=180)
        if r.status_code == 404 and attempt == 0:
            continue
        r.raise_for_status()
        return r.json()


def _get(path):
    for attempt in range(2):
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(attempt == 1)},
                         timeout=120)
        if r.status_code == 404 and attempt == 0:
            continue
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def store_file(kind: str, data: bytes, content_type: str, ext: str, filename: str = "",
                     business_id=None, uploaded_by=None) -> dict:
    fid = new_id()
    owner = business_id or "platform"
    res = await asyncio.to_thread(_put, f"{APP_NAME}/{kind}/{owner}/{fid}.{ext}", data, content_type)
    doc = {"id": fid, "path": res["path"], "kind": kind, "business_id": business_id, "content_type": content_type,
           "size": len(data), "filename": filename, "sha1": hashlib.sha1(data).hexdigest(),
           "uploaded_by": uploaded_by, "is_deleted": False, "created_at": now_iso()}
    await db.files.insert_one(dict(doc))
    _cache_set(fid, (data, content_type))
    return doc


def _cache_set(k, v):
    _cache[k] = v
    _cache.move_to_end(k)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


async def read_file(file_doc: dict):
    fid = file_doc["id"]
    if fid in _cache:
        _cache.move_to_end(fid)
        return _cache[fid]
    data, _ct = await asyncio.to_thread(_get, file_doc["path"])
    val = (data, file_doc.get("content_type") or _ct)
    _cache_set(fid, val)
    return val


# ---------- settings (secrets encrypted at rest) ----------
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(JWT_SECRET.encode()).digest()))
SECRET_KEYS = ("mp_access_token", "mp_webhook_secret", "elevenlabs_api_key")
DEFAULT_SETTINGS = {
    "platform_name": "MarkImagem Rádio Web",
    "support_email": "markimagem2014@gmail.com",
    "support_phone": "",
    "mp_mode": "teste",
    "mp_access_token": "",
    "mp_public_key": "",
    "mp_webhook_secret": "",
    "elevenlabs_api_key": "",
    "elevenlabs_model": "eleven_multilingual_v2",
    "openai_tts_model": "tts-1-hd",
    "default_voice": "openai:onyx",
    "tts_monthly_char_limit_per_client": 20000,
    "grace_days": 5,
    "suspend_radio_when_overdue": True,
    "expiry_alert_days": 3,
    "email_enabled": False,
    "playlist_max_hours": 12,
}


async def get_settings(secrets=False) -> dict:
    doc = await db.system_settings.find_one({"key": "general"}, NOID) or {}
    s = {**DEFAULT_SETTINGS, **doc.get("values", {})}
    for k in SECRET_KEYS:
        v = s.get(k) or ""
        if v:
            try:
                v = _fernet.decrypt(v.encode()).decode()
            except Exception:
                v = ""
        s[k] = v if secrets else (("••••" + v[-4:]) if v else "")
    return s


async def save_settings(patch: dict):
    doc = await db.system_settings.find_one({"key": "general"}, NOID) or {"values": {}}
    values = doc.get("values", {})
    for k, v in patch.items():
        if k not in DEFAULT_SETTINGS:
            continue
        if k in SECRET_KEYS:
            if v is None or str(v).startswith("••••"):
                continue
            values[k] = _fernet.encrypt(v.encode()).decode() if v else ""
        else:
            values[k] = v
    await db.system_settings.update_one({"key": "general"}, {"$set": {"values": values, "updated_at": now_iso()}},
                                        upsert=True)


# ---------- audit / notifications / errors ----------
async def audit(user, action: str, entity: str, entity_id=None, details=None, business_id=None):
    await db.audit_logs.insert_one({
        "id": new_id(), "user_id": (user or {}).get("id"), "user_email": (user or {}).get("email", "sistema"),
        "action": action, "entity": entity, "entity_id": entity_id, "details": details or {},
        "business_id": business_id, "created_at": now_iso()})


async def log_error(source: str, message: str, details=None, business_id=None):
    logger.error(f"[{source}] {message}")
    await db.error_logs.insert_one({"id": new_id(), "source": source, "message": message[:2000],
                                    "details": details or {}, "business_id": business_id,
                                    "created_at": now_iso()})


async def notify(title: str, message: str, business_id=None, role=None, user_id=None, link=None, kind="info"):
    q = {}
    if user_id:
        q = {"id": user_id}
    elif business_id:
        q = {"business_id": business_id}
    elif role:
        q = {"role": {"$in": list(role) if isinstance(role, (list, tuple)) else [role]}}
    users = await db.users.find(q, {"id": 1, "_id": 0}).to_list(500)
    docs = [{"id": new_id(), "user_id": u["id"], "business_id": business_id, "title": title, "message": message,
             "link": link, "kind": kind, "read": False, "created_at": now_iso()} for u in users]
    if docs:
        await db.notifications.insert_many(docs)


# ---------- subscriptions / ads helpers ----------
async def subscription_access(business_id: str):
    sub = await db.subscriptions.find_one({"business_id": business_id}, NOID, sort=[("created_at", -1)])
    if not sub:
        return False, None, "Nenhuma assinatura contratada"
    st = sub["status"]
    if st in ("teste", "ativa", "cancelamento_solicitado"):
        return True, sub, ""
    if st == "inadimplente":
        s = await get_settings()
        since = sub.get("overdue_since") or sub.get("updated_at") or now_iso()
        if not s["suspend_radio_when_overdue"] or \
                datetime.fromisoformat(since) + timedelta(days=int(s["grace_days"])) > now():
            return True, sub, "Pagamento em atraso — período de tolerância"
        return False, sub, "Assinatura suspensa por inadimplência"
    if st == "pagamento_pendente":
        return False, sub, "Aguardando confirmação do pagamento"
    return False, sub, "Assinatura inativa"


def ad_is_eligible(ad: dict, dt=None) -> bool:
    dt = dt or local_now()
    d = dt.date().isoformat()
    if ad.get("status") not in AD_PLAYABLE or not ad.get("audio_file_id"):
        return False
    if ad.get("start_date") and d < ad["start_date"]:
        return False
    if ad.get("end_date") and d > ad["end_date"]:
        return False
    days = ad.get("days") or []
    if days and dt.weekday() not in days:
        return False
    hs, he = ad.get("hour_start"), ad.get("hour_end")
    hm = dt.strftime("%H:%M")
    if hs and hm < hs:
        return False
    if he and hm > he:
        return False
    return True
