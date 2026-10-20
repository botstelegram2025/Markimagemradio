import os
import time
from collections import defaultdict, deque

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from core import db, logger, init_storage, hash_password, verify_password, new_id, now_iso, log_error
import routes_auth
import routes_admin
import routes_billing
import routes_music
import routes_ads
import routes_radio

app = FastAPI(title="MarkImagem Rádio Web API")

for r in (routes_auth.router, routes_admin.router, routes_billing.router, routes_music.router,
          routes_ads.router, routes_radio.router):
    app.include_router(r, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ["CORS_ORIGINS"].split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_hits = defaultdict(deque)
RATE_LIMIT = 600  # requests per minute per IP


@app.middleware("http")
async def guard(request: Request, call_next):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0]
    q = _hits[ip]
    t = time.time()
    while q and q[0] < t - 60:
        q.popleft()
    q.append(t)
    if len(q) > RATE_LIMIT:
        return JSONResponse({"detail": "Muitas requisições. Aguarde um instante."}, status_code=429)
    try:
        return await call_next(request)
    except Exception as e:
        await log_error("api", f"{request.method} {request.url.path}: {e}")
        return JSONResponse({"detail": "Erro interno. O problema foi registrado."}, status_code=500)


CATEGORIES = ["Açougue", "Mercearia", "Padaria", "FLV — frutas, legumes e verduras", "Sacolão", "Bebidas",
              "Frios e laticínios", "Limpeza", "Higiene pessoal", "Hortifrúti", "Supermercado",
              "Restaurante e lanchonete", "Farmácia", "Loja de roupas", "Material de construção",
              "Ofertas gerais", "Anúncios institucionais", "Datas comemorativas", "Serviços locais"]

PLANS = [
    ("Plano Essencial", "Rádio personalizada com anúncios essenciais.", 3, 2, True),
    ("Plano Comercial", "Mais anúncios e solicitações para o comércio ativo.", 8, 6, True),
    ("Plano Premium", "Programação completa, prioridade e intervalos personalizados.", 20, 15, False),
    ("Plano Personalizado", "Condições sob medida definidas pela MarkImagem.", 0, 0, True),
]


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.businesses.create_index("id", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.payment_events.create_index("event_key", unique=True)
    await db.cron_runs.create_index("run_id", unique=True)
    for coll, keys in {"ads": ["business_id", "status", "end_date"], "tracks": ["status", "sha1", "package_id"],
                       "playback_history": ["business_id", "started_at", "type"],
                       "subscriptions": ["business_id", "status", "mp_preapproval_id"],
                       "payments": ["business_id", "mp_payment_id"], "notifications": ["user_id"],
                       "ad_requests": ["business_id", "status"], "files": ["id"], "audit_logs": ["created_at"]}.items():
        for k in keys:
            await db[coll].create_index(k)

    email, pwd = os.environ["ADMIN_EMAIL"].lower(), os.environ["ADMIN_PASSWORD"]
    admin = await db.users.find_one({"email": email})
    if not admin:
        await db.users.insert_one({"id": new_id(), "email": email, "name": "MarkImagem", "role": "superadmin",
                                   "password_hash": hash_password(pwd), "active": True, "created_at": now_iso()})
    elif not verify_password(pwd, admin["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(pwd)}})

    if await db.ad_categories.count_documents({}) == 0:
        await db.ad_categories.insert_many([{"id": new_id(), "name": n, "active": True, "order": i,
                                             "created_at": now_iso()} for i, n in enumerate(CATEGORIES)])
    if await db.plans.count_documents({}) == 0:
        await db.plans.insert_many([{
            "id": new_id(), "name": n, "description": d, "price": 0.0, "promo_price": None,
            "billing_period_months": 1, "max_active_ads": a, "max_requests_month": r, "max_categories": 0,
            "features": [], "storage_mb": 200, "can_request_updates": True, "support_type": "E-mail e WhatsApp",
            "trial_days": 0, "published": False, "requires_approval": appr, "allow_attachments": True,
            "client_preview_approval": False, "custom_breaks": n == "Plano Premium", "order": i,
            "created_at": now_iso()} for i, (n, d, a, r, appr) in enumerate(PLANS)])
    if not await db.programming_rules.find_one({"scope": "global"}):
        await db.programming_rules.insert_one({"scope": "global", **routes_radio.DEFAULT_RULES})
    try:
        init_storage()
        logger.info("Object storage ready")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    from core import client
    client.close()
