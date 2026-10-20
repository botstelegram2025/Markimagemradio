import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field

from core import (db, now, now_iso, new_id, require_roles, client_business, get_settings, audit, notify, log_error,
                  ROLE_SUPER, ROLE_CLIENT, STAFF, SUB_STATUSES)

router = APIRouter()
P = {"_id": 0}
MP_API = "https://api.mercadopago.com"
superadmin = require_roles(ROLE_SUPER)
client_only = require_roles(ROLE_CLIENT)


class PlanIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = ""
    price: float = Field(ge=0)
    promo_price: float | None = Field(default=None, ge=0)
    billing_period_months: int = Field(default=1, ge=1, le=12)
    max_active_ads: int = Field(default=0, ge=0)
    max_requests_month: int = Field(default=0, ge=0)
    max_categories: int = Field(default=0, ge=0)
    features: list[str] = []
    storage_mb: int = Field(default=200, ge=0)
    can_request_updates: bool = True
    support_type: str = ""
    trial_days: int = Field(default=0, ge=0, le=60)
    published: bool = False
    requires_approval: bool = True
    allow_attachments: bool = True
    client_preview_approval: bool = False
    custom_breaks: bool = False
    order: int = 0


def plan_amount(plan):
    return float(plan["promo_price"]) if plan.get("promo_price") else float(plan["price"])


@router.get("/plans")
async def public_plans():
    return await db.plans.find({"published": True, "archived": {"$ne": True}}, P).sort("order", 1).to_list(50)


@router.get("/admin/plans")
async def admin_plans(user=Depends(superadmin)):
    return await db.plans.find({"archived": {"$ne": True}}, P).sort("order", 1).to_list(100)


@router.post("/admin/plans")
async def create_plan(body: PlanIn, user=Depends(superadmin)):
    plan = {**body.model_dump(), "id": new_id(), "created_at": now_iso()}
    await db.plans.insert_one(dict(plan))
    await audit(user, "plan_create", "plan", plan["id"], body.model_dump())
    plan.pop("_id", None)
    return plan


@router.put("/admin/plans/{pid}")
async def update_plan(pid: str, body: PlanIn, user=Depends(superadmin)):
    r = await db.plans.update_one({"id": pid}, {"$set": {**body.model_dump(), "updated_at": now_iso()}})
    if not r.matched_count:
        raise HTTPException(404, "Plano não encontrado")
    await audit(user, "plan_update", "plan", pid, body.model_dump())
    return await db.plans.find_one({"id": pid}, P)


@router.delete("/admin/plans/{pid}")
async def archive_plan(pid: str, user=Depends(superadmin)):
    await db.plans.update_one({"id": pid}, {"$set": {"archived": True, "published": False}})
    await audit(user, "plan_archive", "plan", pid)
    return {"ok": True}


# ---------------- Mercado Pago helpers ----------------
async def mp(method: str, path: str, **kw):
    s = await get_settings(secrets=True)
    if not s["mp_access_token"]:
        raise HTTPException(400, "Mercado Pago não configurado. O administrador deve informar o Access Token.")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.request(method, MP_API + path, headers={"Authorization": f"Bearer {s['mp_access_token']}",
                                                            "Content-Type": "application/json"}, **kw)
    if r.status_code >= 400:
        await log_error("mercadopago", f"{method} {path} -> {r.status_code}: {r.text[:500]}")
        raise HTTPException(502, f"Mercado Pago recusou a operação: {r.text[:200]}")
    return r.json()


def verify_signature(secret, x_signature, x_request_id, data_id):
    if not secret or not x_signature:
        return False
    parts = dict(p.strip().split("=", 1) for p in x_signature.split(",") if "=" in p)
    ts, v1 = parts.get("ts"), parts.get("v1")
    if not ts or not v1:
        return False
    try:
        t = int(ts)
        t = t / 1000 if t > 10_000_000_000 else t
        if abs(time.time() - t) > 600:
            return False
    except ValueError:
        return False
    msg = (f"id:{data_id.lower() if data_id and data_id.isalnum() else data_id};" if data_id else "") + \
          (f"request-id:{x_request_id};" if x_request_id else "") + f"ts:{ts};"
    expected = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


async def set_sub_status(sub, status, note, extra=None):
    upd = {"status": status, "updated_at": now_iso(), **(extra or {})}
    if status == "inadimplente" and not sub.get("overdue_since"):
        upd["overdue_since"] = now_iso()
    if status == "ativa":
        upd["overdue_since"] = None
    await db.subscriptions.update_one({"id": sub["id"]}, {"$set": upd, "$push": {
        "history": {"status": status, "note": note, "at": now_iso()}}})
    if status != sub.get("status"):
        labels = {"ativa": "Assinatura ativa", "inadimplente": "Pagamento em atraso",
                  "cancelada": "Assinatura cancelada", "pagamento_pendente": "Pagamento pendente"}
        if status in labels:
            await notify(labels[status], note, business_id=sub["business_id"], link="/cliente/assinatura",
                         kind="warning" if status != "ativa" else "success")
    if status == "ativa":
        await db.subscriptions.update_many({"business_id": sub["business_id"], "id": {"$ne": sub["id"]},
                                            "status": {"$in": ["ativa", "teste", "inadimplente",
                                                               "pagamento_pendente"]}},
                                           {"$set": {"status": "encerrada", "updated_at": now_iso()}})


async def sync_preapproval(sub):
    pre = await mp("GET", f"/preapproval/{sub['mp_preapproval_id']}")
    st = pre.get("status")
    extra = {"mp_status": st, "next_payment_date": pre.get("next_payment_date"),
             "payer_email": pre.get("payer_email")}
    if st == "authorized":
        npd = pre.get("next_payment_date")
        extra["current_period_end"] = npd or (now() + timedelta(days=31)).isoformat()
        await set_sub_status(sub, "ativa", "Assinatura autorizada no Mercado Pago (verificado no servidor)", extra)
    elif st == "pending":
        await set_sub_status(sub, "pagamento_pendente", "Aguardando autorização do pagamento", extra)
    elif st == "paused":
        await set_sub_status(sub, "inadimplente", "Assinatura pausada no Mercado Pago", extra)
    elif st == "cancelled":
        final = "cancelamento_solicitado" if sub["status"] == "cancelamento_solicitado" and \
            sub.get("current_period_end", "") > now_iso() else "cancelada"
        await set_sub_status(sub, final, "Assinatura cancelada no Mercado Pago", extra)
    return await db.subscriptions.find_one({"id": sub["id"]}, P)


async def record_payment(sub, mp_payment_id, amount, status, detail, authorized_id=None, date=None):
    mapped = {"approved": "aprovado", "authorized": "aprovado", "pending": "pendente", "in_process": "pendente",
              "rejected": "recusado", "cancelled": "recusado", "refunded": "estornado",
              "charged_back": "estornado"}.get(status, status or "pendente")
    key = {"mp_payment_id": str(mp_payment_id)} if mp_payment_id else {"mp_authorized_payment_id": str(authorized_id)}
    existing = await db.payments.find_one(key, P)
    doc = {"business_id": sub["business_id"], "subscription_id": sub["id"], "plan_name": sub.get("plan_name"),
           "mp_payment_id": str(mp_payment_id) if mp_payment_id else None,
           "mp_authorized_payment_id": str(authorized_id) if authorized_id else None, "amount": amount,
           "status": mapped, "status_detail": detail, "paid_at": date or now_iso(), "updated_at": now_iso()}
    if existing:
        await db.payments.update_one(key, {"$set": doc})
    else:
        await db.payments.insert_one({**doc, "id": new_id(), "receipt_number": f"MKR-{int(time.time())}",
                                      "created_at": now_iso()})
    if mapped == "aprovado":
        await set_sub_status(sub, "ativa", f"Pagamento aprovado (R$ {amount:.2f})".replace(".", ","),
                             {"current_period_end": (now() + timedelta(days=31 * sub.get('period_months', 1)))
                              .isoformat()})
    elif mapped == "recusado":
        await set_sub_status(sub, "inadimplente", f"Pagamento recusado: {detail or 'verifique seu cartão'}")


# ---------------- client subscription ----------------
@router.get("/client/subscription")
async def my_subscription(user=Depends(client_only)):
    biz = await client_business(user)
    sub = await db.subscriptions.find_one({"business_id": biz["id"]}, P, sort=[("created_at", -1)])
    plan = (await db.plans.find_one({"id": sub["plan_id"]}, P)) if sub else None
    payments = await db.payments.find({"business_id": biz["id"]}, P).sort("created_at", -1).to_list(200)
    return {"subscription": sub, "plan": plan, "payments": payments}


class CheckoutIn(BaseModel):
    plan_id: str
    payer_email: str | None = None


@router.post("/client/subscription/checkout")
async def checkout(body: CheckoutIn, user=Depends(client_only)):
    biz = await client_business(user)
    plan = await db.plans.find_one({"id": body.plan_id, "published": True, "archived": {"$ne": True}}, P)
    if not plan:
        raise HTTPException(404, "Plano indisponível")
    amount = plan_amount(plan)
    used_trial = await db.subscriptions.find_one({"business_id": biz["id"], "trial_used": True})
    if plan.get("trial_days") and not used_trial:
        sub = {"id": new_id(), "business_id": biz["id"], "plan_id": plan["id"], "plan_name": plan["name"],
               "amount": amount, "status": "teste", "trial_used": True, "period_months": plan["billing_period_months"],
               "trial_end": (now() + timedelta(days=plan["trial_days"])).isoformat(), "created_at": now_iso(),
               "updated_at": now_iso(), "history": [{"status": "teste", "note": "Período de teste", "at": now_iso()}]}
        await db.subscriptions.insert_one(dict(sub))
        await audit(user, "trial_start", "subscription", sub["id"], business_id=biz["id"])
        return {"trial": True, "subscription_id": sub["id"]}
    if amount <= 0:
        raise HTTPException(400, "Este plano ainda não possui preço definido. Fale com a MarkImagem.")
    sub_id = new_id()
    payload = {"reason": f"MarkImagem Rádio Web — {plan['name']}", "external_reference": sub_id,
               "payer_email": (body.payer_email or user["email"]).strip().lower(),
               "auto_recurring": {"frequency": plan["billing_period_months"], "frequency_type": "months",
                                  "transaction_amount": round(amount, 2), "currency_id": "BRL"},
               "back_url": f"{os.environ['FRONTEND_URL']}/cliente/assinatura?retorno=1", "status": "pending"}
    pre = await mp("POST", "/preapproval", json=payload)
    sub = {"id": sub_id, "business_id": biz["id"], "plan_id": plan["id"], "plan_name": plan["name"], "amount": amount,
           "status": "pagamento_pendente", "mp_preapproval_id": pre["id"], "init_point": pre.get("init_point"),
           "period_months": plan["billing_period_months"], "created_at": now_iso(), "updated_at": now_iso(),
           "history": [{"status": "pagamento_pendente", "note": "Checkout iniciado", "at": now_iso()}]}
    await db.subscriptions.insert_one(dict(sub))
    await audit(user, "checkout_start", "subscription", sub_id, {"plan": plan["name"]}, business_id=biz["id"])
    return {"checkout_url": pre.get("init_point"), "subscription_id": sub_id}


@router.post("/client/subscription/sync")
async def sync_mine(user=Depends(client_only)):
    biz = await client_business(user)
    sub = await db.subscriptions.find_one({"business_id": biz["id"], "mp_preapproval_id": {"$ne": None}}, P,
                                          sort=[("created_at", -1)])
    if not sub:
        raise HTTPException(404, "Nenhuma assinatura do Mercado Pago encontrada")
    return await sync_preapproval(sub)


@router.post("/client/subscription/cancel")
async def cancel_mine(user=Depends(client_only)):
    biz = await client_business(user)
    sub = await db.subscriptions.find_one({"business_id": biz["id"], "status": {"$in": ["ativa", "teste",
                                           "pagamento_pendente", "inadimplente"]}}, P, sort=[("created_at", -1)])
    if not sub:
        raise HTTPException(404, "Nenhuma assinatura ativa")
    if sub.get("mp_preapproval_id"):
        await mp("PUT", f"/preapproval/{sub['mp_preapproval_id']}", json={"status": "cancelled"})
    has_period = sub.get("current_period_end", "") > now_iso()
    await set_sub_status(sub, "cancelamento_solicitado" if has_period else "cancelada",
                         "Cancelamento solicitado pelo cliente", {"cancel_requested_at": now_iso()})
    await notify("Cancelamento de assinatura", f"{biz['name']} solicitou cancelamento.", role=[ROLE_SUPER])
    await audit(user, "subscription_cancel", "subscription", sub["id"], business_id=biz["id"])
    return await db.subscriptions.find_one({"id": sub["id"]}, P)


# ---------------- webhook ----------------
@router.get("/billing/webhook")
async def webhook_probe():
    return {"ok": True}


@router.post("/billing/webhook")
async def webhook(request: Request, data_id: str | None = Query(default=None, alias="data.id")):
    s = await get_settings(secrets=True)
    try:
        event = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")
    rid = data_id or str((event.get("data") or {}).get("id") or "")
    if not verify_signature(s["mp_webhook_secret"], request.headers.get("x-signature"),
                            request.headers.get("x-request-id"), data_id):
        await log_error("webhook", "Assinatura inválida ou segredo não configurado", {"id": rid})
        raise HTTPException(401, "Assinatura inválida")
    topic = event.get("type") or event.get("topic") or ""
    key = f"{request.headers.get('x-request-id')}:{topic}:{rid}:{event.get('action', '')}"
    try:
        await db.payment_events.insert_one({"event_key": key, "topic": topic, "resource_id": rid, "payload": event,
                                            "processed": False, "received_at": now_iso()})
    except Exception:
        return {"ok": True, "duplicate": True}
    try:
        if topic == "subscription_preapproval":
            sub = await db.subscriptions.find_one({"mp_preapproval_id": rid}, P)
            if sub:
                await sync_preapproval(sub)
        elif topic == "subscription_authorized_payment":
            inv = await mp("GET", f"/authorized_payments/{rid}")
            sub = await db.subscriptions.find_one({"mp_preapproval_id": inv.get("preapproval_id")}, P)
            if sub:
                pay = inv.get("payment") or {}
                await record_payment(sub, pay.get("id"), float(inv.get("transaction_amount") or sub["amount"]),
                                     pay.get("status") or inv.get("status"), pay.get("status_detail"), rid,
                                     inv.get("date_created"))
        elif topic == "payment":
            pay = await mp("GET", f"/v1/payments/{rid}")
            ref = pay.get("external_reference")
            pre_id = (pay.get("metadata") or {}).get("preapproval_id")
            sub = await db.subscriptions.find_one({"$or": [{"id": ref}, {"mp_preapproval_id": pre_id}]}, P) \
                if (ref or pre_id) else None
            if sub:
                await record_payment(sub, rid, float(pay.get("transaction_amount") or 0), pay.get("status"),
                                     pay.get("status_detail"), None, pay.get("date_approved"))
        await db.payment_events.update_one({"event_key": key}, {"$set": {"processed": True}})
    except HTTPException as e:
        await db.payment_events.update_one({"event_key": key}, {"$set": {"error": str(e.detail)}})
    return {"ok": True}


# ---------------- admin ----------------
@router.get("/admin/subscriptions")
async def admin_subs(status: str = "", user=Depends(superadmin)):
    q = {"status": status} if status else {}
    return await db.subscriptions.find(q, {"_id": 0, "history": 0}).sort("created_at", -1).to_list(2000)


class SubPatch(BaseModel):
    status: str
    note: str = "Alteração manual pelo administrador"
    current_period_end: str | None = None


@router.patch("/admin/subscriptions/{sid}")
async def admin_sub_patch(sid: str, body: SubPatch, user=Depends(superadmin)):
    sub = await db.subscriptions.find_one({"id": sid}, P)
    if not sub or body.status not in SUB_STATUSES:
        raise HTTPException(400, "Assinatura ou status inválido")
    extra = {"current_period_end": body.current_period_end} if body.current_period_end else {}
    await set_sub_status(sub, body.status, body.note, extra)
    await audit(user, "subscription_manual", "subscription", sid, body.model_dump(), business_id=sub["business_id"])
    return await db.subscriptions.find_one({"id": sid}, P)


class ManualSubIn(BaseModel):
    business_id: str
    plan_id: str
    status: str = "ativa"
    months: int = Field(default=1, ge=1, le=24)


@router.post("/admin/subscriptions")
async def admin_sub_create(body: ManualSubIn, user=Depends(superadmin)):
    plan = await db.plans.find_one({"id": body.plan_id}, P)
    if not plan or not await db.businesses.find_one({"id": body.business_id}):
        raise HTTPException(400, "Plano ou cliente inválido")
    sub = {"id": new_id(), "business_id": body.business_id, "plan_id": plan["id"], "plan_name": plan["name"],
           "amount": plan_amount(plan), "status": body.status, "period_months": body.months, "manual": True,
           "current_period_end": (now() + timedelta(days=31 * body.months)).isoformat(), "created_at": now_iso(),
           "updated_at": now_iso(), "history": [{"status": body.status, "note": "Criada manualmente", "at": now_iso()}]}
    await db.subscriptions.insert_one(dict(sub))
    if body.status == "ativa":
        await set_sub_status(sub, "ativa", "Assinatura liberada pela MarkImagem")
    await audit(user, "subscription_create_manual", "subscription", sub["id"], business_id=body.business_id)
    sub.pop("_id", None)
    return sub


@router.post("/admin/subscriptions/{sid}/sync")
async def admin_sync(sid: str, user=Depends(superadmin)):
    sub = await db.subscriptions.find_one({"id": sid}, P)
    if not sub or not sub.get("mp_preapproval_id"):
        raise HTTPException(400, "Assinatura sem vínculo com o Mercado Pago")
    return await sync_preapproval(sub)


@router.get("/admin/payments")
async def admin_payments(status: str = "", business_id: str = "", user=Depends(superadmin)):
    q = {k: v for k, v in {"status": status, "business_id": business_id}.items() if v}
    pays = await db.payments.find(q, P).sort("created_at", -1).to_list(2000)
    names = {b["id"]: b["name"] for b in await db.businesses.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)}
    for p in pays:
        p["business_name"] = names.get(p["business_id"], "-")
    return pays


@router.get("/admin/payment-events")
async def payment_events(user=Depends(superadmin)):
    return await db.payment_events.find({}, {"_id": 0, "payload": 0}).sort("received_at", -1).to_list(300)


@router.post("/admin/settings/test-mp")
async def test_mp(user=Depends(superadmin)):
    me = await mp("GET", "/users/me")
    return {"ok": True, "account": me.get("nickname") or me.get("email"), "site": me.get("site_id")}


async def subscription_maintenance():
    s = await get_settings()
    out = {"trial_ended": 0, "overdue": 0, "cancelled": 0}
    async for sub in db.subscriptions.find({"status": "teste", "trial_end": {"$lt": now_iso()}}, P):
        await set_sub_status(sub, "encerrada", "Período de teste encerrado. Contrate um plano para continuar.")
        out["trial_ended"] += 1
    async for sub in db.subscriptions.find({"status": "cancelamento_solicitado",
                                            "current_period_end": {"$lt": now_iso()}}, P):
        await set_sub_status(sub, "cancelada", "Período pago encerrado após cancelamento")
        out["cancelled"] += 1
    limit = (now() - timedelta(days=3)).isoformat()
    async for sub in db.subscriptions.find({"status": "ativa", "manual": {"$ne": True},
                                            "current_period_end": {"$lt": limit}}, P):
        await set_sub_status(sub, "inadimplente", f"Mensalidade não confirmada. Tolerância de {s['grace_days']} dias.")
        out["overdue"] += 1
    return out
