import secrets
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from core import (db, NOID, now, now_iso, new_id, hash_password, verify_password, set_auth_cookies,
                  get_current_user, public_user, JWT_SECRET, JWT_ALG, make_token, audit, notify, STAFF)

router = APIRouter()


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    business_name: str = Field(min_length=2, max_length=160)
    phone: str = Field(default="", max_length=30)
    segment: str = Field(default="", max_length=80)
    consent: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=10)
    password: str = Field(min_length=8, max_length=128)


class ChangePwdIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


async def with_business(u: dict) -> dict:
    out = public_user(u)
    if u.get("business_id"):
        out["business"] = await db.businesses.find_one({"id": u["business_id"]}, NOID)
    return out


@router.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    if not body.consent:
        raise HTTPException(400, "É necessário aceitar a Política de Privacidade (LGPD)")
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    uid, bid = new_id(), new_id()
    await db.businesses.insert_one({"id": bid, "name": body.business_name.strip(), "owner_user_id": uid,
                                    "phone": body.phone, "segment": body.segment, "address": "", "city": "",
                                    "state": "", "cnpj": "", "logo_file_id": None, "status": "ativo",
                                    "created_at": now_iso()})
    user = {"id": uid, "email": email, "name": body.name.strip(), "role": "cliente", "business_id": bid,
            "password_hash": hash_password(body.password), "active": True, "lgpd_consent_at": now_iso(),
            "created_at": now_iso()}
    await db.users.insert_one(dict(user))
    await audit(user, "register", "user", uid, business_id=bid)
    await notify("Novo cliente cadastrado", f"{body.business_name} criou uma conta.", role=STAFF,
                 link="/admin/clientes")
    set_auth_cookies(response, uid)
    return await with_business(user)


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0]
    ident = f"{ip}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= 5 and att.get("locked_until") and att["locked_until"] > now():
        raise HTTPException(429, "Muitas tentativas. Tente novamente em 15 minutos.")
    user = await db.users.find_one({"email": email}, NOID)
    if not user or not verify_password(body.password, user["password_hash"]):
        expired_lock = att and att.get("locked_until") and att["locked_until"] <= now()
        count = (0 if expired_lock else (att or {}).get("count", 0)) + 1
        await db.login_attempts.update_one({"identifier": ident}, {"$set": {
            "count": count, "locked_until": now() + timedelta(minutes=15) if count >= 5 else None}}, upsert=True)
        raise HTTPException(401, "E-mail ou senha inválidos")
    if not user.get("active", True):
        raise HTTPException(403, "Usuário desativado. Fale com o suporte.")
    await db.login_attempts.delete_many({"identifier": ident})
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    await audit(user, "login", "user", user["id"], business_id=user.get("business_id"))
    set_auth_cookies(response, user["id"])
    return await with_business(user)


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", secure=True, samesite="none")
    response.delete_cookie("refresh_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, NOID)
    return await with_business(full)


@router.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "Sem sessão")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Sessão expirada")
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, NOID)
    if not user or not user.get("active", True):
        raise HTTPException(401, "Usuário inválido")
    response.set_cookie("access_token", make_token(user["id"], "access", 120), httponly=True, secure=True,
                        samesite="none", max_age=7200, path="/")
    return {"ok": True}


@router.post("/auth/forgot-password")
async def forgot(body: ForgotIn, request: Request):
    user = await db.users.find_one({"email": body.email.lower()}, NOID)
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({"token": token, "user_id": user["id"], "used": False,
                                                   "expires_at": now() + timedelta(hours=1)})
        origin = request.headers.get("origin", "")
        # Email delivery not configured yet: the link is recorded for the superadmin in the audit log.
        await audit(user, "password_reset_requested", "user", user["id"],
                    {"reset_link": f"{origin}/redefinir-senha?token={token}"}, business_id=user.get("business_id"))
    return {"ok": True, "message": "Se o e-mail existir, as instruções de redefinição foram geradas."}


@router.post("/auth/reset-password")
async def reset(body: ResetIn):
    rec = await db.password_reset_tokens.find_one({"token": body.token})
    if not rec or rec.get("used"):
        raise HTTPException(400, "Link inválido ou já utilizado")
    exp = rec["expires_at"]
    if exp.tzinfo is None:
        from datetime import timezone
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now():
        raise HTTPException(400, "Link expirado")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_password(body.password)}})
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    await audit({"id": rec["user_id"]}, "password_reset", "user", rec["user_id"])
    return {"ok": True}


@router.post("/auth/change-password")
async def change_password(body: ChangePwdIn, user=Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Senha atual incorreta")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await audit(user, "password_changed", "user", user["id"])
    return {"ok": True}
