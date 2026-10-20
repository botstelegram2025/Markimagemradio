# MarkImagem Rádio Web - backend regression tests (auth, roles, plans, billing, music, ads, radio, settings, reports)
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "markimagem2014@gmail.com", "password": "Aw@3eszx"}
ASSETS = "/app/tests/assets"
CRON = [l.split("=", 1)[1].strip().strip('"') for l in open("/app/backend/.env") if l.startswith("WEBHOOK_CRON_SECRET")][0]
RUN = uuid.uuid4().hex[:6]
TODAY = date.today()
S = {}  # shared state across ordered tests


def sess():
    return requests.Session()


def register(tag):
    s = sess()
    email = f"test_{tag}_{RUN}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": f"TEST_{tag}", "email": email, "password": "Teste@1234",
                                              "business_name": f"TEST_Loja_{tag}_{RUN}", "consent": True})
    assert r.status_code == 200, r.text
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    s = sess()
    r = s.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def client_a():
    s, u = register("A")
    S["a_user"], S["a_bid"] = u, u["business_id"]
    return s


@pytest.fixture(scope="module")
def client_b():
    s, u = register("B")
    S["b_user"], S["b_bid"] = u, u["business_id"]
    return s


@pytest.fixture(scope="module")
def operator(admin):
    email = f"test_oper_{RUN}@example.com"
    r = admin.post(f"{API}/admin/users", json={"name": "TEST_Oper", "email": email, "password": "Oper@12345",
                                                "role": "operador"})
    assert r.status_code == 200, r.text
    S["oper_id"] = r.json()["id"]
    s = sess()
    assert s.post(f"{API}/auth/login", json={"email": email, "password": "Oper@12345"}).status_code == 200
    return s


# ---------- Auth ----------
class TestAuth:
    def test_login_cookies_and_me(self, admin):
        s = sess()
        r = s.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200 and r.json()["role"] == "superadmin"
        assert "password_hash" not in r.json()
        sc = r.headers.get("set-cookie", "").lower()
        assert "httponly" in sc and "access_token" in sc and "refresh_token" in sc
        assert s.get(f"{API}/auth/me").json()["email"] == ADMIN["email"]
        s.post(f"{API}/auth/logout")
        s.cookies.clear()
        assert s.get(f"{API}/auth/me").status_code == 401

    def test_register_requires_consent(self):
        r = sess().post(f"{API}/auth/register", json={"name": "TEST_x", "email": f"test_nc_{RUN}@example.com",
                                                       "password": "Teste@1234", "business_name": "TEST_x",
                                                       "consent": False})
        assert r.status_code == 400 and "LGPD" in r.json()["detail"]

    def test_register_client(self, client_a):
        me = client_a.get(f"{API}/auth/me").json()
        assert me["role"] == "cliente" and me["business"]["name"].startswith("TEST_Loja_A")

    def test_bruteforce_lockout(self, client_a):
        s = sess()
        email = S["a_user"]["email"]
        codes = [s.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429, codes
        assert s.post(f"{API}/auth/login", json={"email": email, "password": "Teste@1234"}).status_code == 429

    def test_cors_credentials(self):
        r = requests.options(f"{API}/auth/login", headers={"Origin": BASE_URL, "Access-Control-Request-Method": "POST"})
        assert r.headers.get("access-control-allow-origin") == BASE_URL
        assert r.headers.get("access-control-allow-credentials") == "true"


# ---------- Role isolation ----------
class TestRoles:
    def test_client_blocked_from_admin(self, client_a):
        for p in ("/admin/dashboard", "/admin/clients", "/admin/ads", "/admin/plans", "/admin/settings"):
            assert client_a.get(f"{API}{p}").status_code == 403, p

    def test_operator_blocked_from_financial(self, operator):
        for p in ("/admin/plans", "/admin/settings", "/admin/payments", "/admin/reports/receita",
                  "/admin/reports/pagamentos", "/admin/subscriptions", "/admin/users"):
            assert operator.get(f"{API}{p}").status_code == 403, p
        assert operator.get(f"{API}/admin/ads").status_code == 200
        assert operator.get(f"{API}/admin/reports/clientes").status_code == 200


# ---------- Plans & subscription ----------
class TestPlans:
    def test_create_and_edit_plan(self, admin):
        r = admin.post(f"{API}/admin/plans", json={"name": f"TEST_Plano_{RUN}", "price": 10, "published": False})
        assert r.status_code == 200
        pid = r.json()["id"]
        r = admin.put(f"{API}/admin/plans/{pid}", json={"name": f"TEST_Plano_{RUN}", "price": 49.90, "trial_days": 7,
                                                        "published": True, "max_active_ads": 0})
        assert r.status_code == 200 and r.json()["price"] == 49.9 and r.json()["trial_days"] == 7
        pub = requests.get(f"{API}/plans").json()
        assert any(p["id"] == pid and p["price"] == 49.9 for p in pub)
        S["plan_trial"] = pid
        r = admin.post(f"{API}/admin/plans", json={"name": f"TEST_PlanoSemTeste_{RUN}", "price": 79.9,
                                                   "published": True, "trial_days": 0})
        S["plan_paid"] = r.json()["id"]

    def test_radio_blocked_without_subscription(self, client_a):
        r = client_a.post(f"{API}/radio/next")
        assert r.status_code == 402

    def test_checkout_trial(self, client_a):
        r = client_a.post(f"{API}/client/subscription/checkout", json={"plan_id": S["plan_trial"]})
        assert r.status_code == 200 and r.json()["trial"] is True
        sub = client_a.get(f"{API}/client/subscription").json()["subscription"]
        assert sub["status"] == "teste"
        st = client_a.get(f"{API}/radio/status").json()
        assert st["allowed"] is True

    def test_checkout_without_mp(self, client_b):
        r = client_b.post(f"{API}/client/subscription/checkout", json={"plan_id": S["plan_paid"]})
        assert r.status_code == 400 and "Mercado Pago não configurado" in r.json()["detail"], r.text


# ---------- Music ----------
class TestMusic:
    def test_upload_mp3(self, admin):
        with open(f"{ASSETS}/Artista Teste - Faixa 1.mp3", "rb") as f:
            r = admin.post(f"{API}/admin/music/upload", files=[("files", ("Artista Teste - Faixa 1.mp3", f, "audio/mpeg"))],
                           data={"package_name": f"TEST_pkg_{RUN}"})
        assert r.status_code == 200, r.text
        S["pkg1"] = r.json()
        print("upload1", {k: v for k, v in r.json().items() if k != "results"})

    def test_upload_zip(self, admin):
        with open(f"{ASSETS}/pacote_teste.zip", "rb") as f:
            r = admin.post(f"{API}/admin/music/upload-zip", files={"file": ("pacote_teste.zip", f, "application/zip")})
        assert r.status_code == 200, r.text
        S["pkg_zip"] = r.json()
        print("zip", {k: (v if not isinstance(v, list) else len(v)) for k, v in r.json().items()})

    def test_duplicate_and_reject(self, admin):
        with open(f"{ASSETS}/Artista Teste - Faixa 1.mp3", "rb") as f:
            r = admin.post(f"{API}/admin/music/upload", files=[("files", ("dup.mp3", f, "audio/mpeg")),
                                                               ("files", ("nota.txt", b"hello", "text/plain"))])
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["duplicates"]) == 1, body
        assert len(body.get("rejected", [])) == 1, body

    def test_playlist_active(self, admin):
        r = admin.get(f"{API}/admin/playlists/active")
        assert r.status_code == 200
        pl = r.json()
        assert pl and len(pl["items"]) > 0
        pk = admin.get(f"{API}/admin/music/packages").json()
        newest = [p for p in pk if p.get("track_ids")][0]
        first = pl["items"][0]; first = first["id"] if isinstance(first, dict) else first
        assert first in newest["track_ids"], "newest package must come first"


# ---------- Ads ----------
class TestAds:
    def test_create_generate_publish(self, admin):
        r = admin.post(f"{API}/admin/ads", json={"title": f"TEST_Ad_{RUN}", "business_id": S["a_bid"],
                                                  "text": "Picanha por apenas R$ 34,90 o quilo, só hoje!",
                                                  "start_date": TODAY.isoformat(),
                                                  "end_date": (TODAY + timedelta(days=10)).isoformat()})
        assert r.status_code == 200 and r.json()["status"] == "rascunho"
        aid = r.json()["id"]
        S["ad"] = aid
        r = admin.post(f"{API}/admin/ads/{aid}/generate", json={"voice": "openai:onyx"}, timeout=120)
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["generation"]["provisional"] is True and g["ad"]["audio_file_id"]
        S["ad_file"] = g["ad"]["audio_file_id"]
        r = admin.post(f"{API}/admin/ads/{aid}/status", json={"status": "publicar"})
        assert r.status_code == 200 and r.json()["status"] == "em_veiculacao", r.text

    def test_media_isolation_and_range(self, client_a, client_b):
        assert client_b.get(f"{API}/media/{S['ad_file']}").status_code == 403
        r = client_a.get(f"{API}/media/{S['ad_file']}", headers={"Range": "bytes=0-99"})
        assert r.status_code == 206 and len(r.content) == 100 and r.headers["content-range"].startswith("bytes 0-99/")
        assert requests.get(f"{API}/media/{S['ad_file']}").status_code == 401

    def test_client_cannot_see_other_ads(self, client_b):
        ads = client_b.get(f"{API}/client/ads").json()
        assert all(a["id"] != S["ad"] for a in ads)

    def test_future_ad_scheduled(self, admin):
        r = admin.post(f"{API}/admin/ads", json={"title": f"TEST_Future_{RUN}", "business_id": S["a_bid"],
                                                  "text": "Oferta futura", "start_date": (TODAY + timedelta(days=5)).isoformat()})
        aid = r.json()["id"]
        with open(f"{ASSETS}/Artista Teste - Faixa 2.mp3", "rb") as f:
            assert admin.post(f"{API}/admin/ads/{aid}/upload-audio",
                              files={"file": ("a.mp3", f, "audio/mpeg")}).status_code == 200
        r = admin.post(f"{API}/admin/ads/{aid}/status", json={"status": "publicar"})
        assert r.json()["status"] == "agendado"

    def test_expired_cannot_publish_and_maintenance(self, admin):
        y = (TODAY - timedelta(days=2)).isoformat()
        r = admin.post(f"{API}/admin/ads", json={"title": f"TEST_Expired_{RUN}", "business_id": S["a_bid"],
                                                  "text": "Velha", "start_date": (TODAY - timedelta(days=10)).isoformat(),
                                                  "end_date": y})
        aid = r.json()["id"]
        with open(f"{ASSETS}/Artista Teste - Faixa 3.mp3", "rb") as f:
            admin.post(f"{API}/admin/ads/{aid}/upload-audio", files={"file": ("a.mp3", f, "audio/mpeg")})
        r = admin.post(f"{API}/admin/ads/{aid}/status", json={"status": "publicar"})
        assert r.status_code == 400 and "vencido" in r.json()["detail"]
        # publish first with valid date then move date to past -> maintenance must expire
        r = admin.post(f"{API}/admin/ads", json={"title": f"TEST_ToExpire_{RUN}", "business_id": S["a_bid"],
                                                  "text": "Expira"})
        aid2 = r.json()["id"]
        with open(f"{ASSETS}/Artista Teste - Faixa 3.mp3", "rb") as f:
            admin.post(f"{API}/admin/ads/{aid2}/upload-audio", files={"file": ("a.mp3", f, "audio/mpeg")})
        assert admin.post(f"{API}/admin/ads/{aid2}/status", json={"status": "publicar"}).json()["status"] == "em_veiculacao"
        admin.patch(f"{API}/admin/ads/{aid2}", json={"start_date": (TODAY - timedelta(days=10)).isoformat(), "end_date": y})
        r = admin.post(f"{API}/admin/maintenance/run")
        assert r.status_code == 200, r.text
        time.sleep(2)
        assert admin.get(f"{API}/admin/ads/{aid2}").json()["ad"]["status"] == "expirado"
        S["expired_ids"] = [aid, aid2]


# ---------- Radio engine ----------
class TestRadio:
    def test_rules_and_interleave(self, admin, client_a):
        orig = admin.get(f"{API}/admin/programming/rules").json()
        S["orig_rules"] = {k: orig.get(k) for k in ("every_n", "ads_paused") if k in orig}
        r = admin.put(f"{API}/admin/programming/rules", json={"every_n": 1, "ads_paused": False})
        assert r.status_code == 200 and r.json()["every_n"] == 1
        items = [client_a.post(f"{API}/radio/next").json() for _ in range(8)]
        types = [i["type"] for i in items]
        print("sequence", [(i["type"], i["title"]) for i in items])
        assert "music" in types and "ad" in types
        assert all(i["id"] not in S.get("expired_ids", []) for i in items)
        ad_ids = {i["id"] for i in items if i["type"] == "ad"}
        assert S["ad"] in ad_ids, "client's own ad should air"

    def test_ads_paused(self, admin, client_a):
        admin.put(f"{API}/admin/programming/rules", json={"ads_paused": True})
        items = [client_a.post(f"{API}/radio/next").json()["type"] for _ in range(5)]
        assert set(items) == {"music"}, items
        admin.put(f"{API}/admin/programming/rules", json={"every_n": 3, "ads_paused": False})

    def test_operator_cannot_change_rules(self, operator):
        assert operator.put(f"{API}/admin/programming/rules", json={"every_n": 1}).status_code == 403


# ---------- Requests ----------
class TestRequests:
    def test_request_and_convert(self, admin, client_a):
        r = client_a.post(f"{API}/client/requests", json={"type": "novo", "title": f"TEST_Req_{RUN}",
                                                          "text": "Promo de pão", "products": "Pão R$ 0,50"})
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        assert any(x["id"] == rid for x in admin.get(f"{API}/admin/requests").json())
        r = admin.post(f"{API}/admin/requests/{rid}/convert")
        assert r.status_code == 200 and r.json()["status"] == "rascunho" and r.json()["request_id"] == rid

    def test_edit_text_clears_audio(self, admin):
        r = admin.patch(f"{API}/admin/ads/{S['ad']}", json={"text": "Novo texto R$ 29,90", "reason": "TEST"})
        assert r.status_code == 200
        ad = admin.get(f"{API}/admin/ads/{S['ad']}").json()
        assert ad["ad"]["status"] == "rascunho" and ad["ad"]["audio_file_id"] is None
        assert len(ad["versions"]) >= 1


# ---------- Voice ----------
class TestVoice:
    def test_profile_consent_upload_clone(self, admin):
        r = admin.post(f"{API}/admin/voice/profiles", json={"name": "TEST_Voz", "consent": False,
                                                             "consent_text": "Autorizo o uso da minha voz"})
        assert r.status_code == 400
        r = admin.post(f"{API}/admin/voice/profiles", json={"name": "TEST_Voz", "consent": True,
                                                             "consent_text": "Autorizo o uso da minha voz"})
        pid = r.json()["id"]
        S["voice_pid"] = pid
        with open(f"{ASSETS}/Artista Teste - Faixa 1.mp3", "rb") as f:
            r = admin.post(f"{API}/admin/voice/profiles/{pid}/recordings", files={"file": ("rec.mp3", f, "audio/mpeg")})
        assert r.status_code == 200, r.text
        r = admin.post(f"{API}/admin/voice/profiles/{pid}/clone")
        assert r.status_code == 400 and "NÃO configurado" in r.json()["detail"]

    def test_voice_test(self, admin):
        r = admin.post(f"{API}/admin/voice/test", json={"voice": "openai:onyx"}, timeout=90)
        assert r.status_code == 200 and r.json()["provisional"] is True


# ---------- AI copy ----------
class TestAI:
    def test_ai_copy_stream(self, admin):
        r = admin.post(f"{API}/admin/ai/copy", json={"products": "Picanha R$ 34,90"}, stream=True, timeout=90)
        assert r.status_code == 200 and "text/event-stream" in r.headers["content-type"]
        body = "".join(c.decode() for c in r.iter_content(None))
        assert '"t"' in body and "[DONE]" in body and "error" not in body, body[:300]


# ---------- Settings / webhook / cron / reports ----------
class TestSettingsReports:
    def test_mp_token_masked(self, admin):
        r = admin.put(f"{API}/admin/settings", json={"mp_access_token": "TEST-fake-token-abcd1234"})
        assert r.status_code == 200
        g = admin.get(f"{API}/admin/settings").json()
        assert g["mp_access_token"] == "••••1234" and "fake" not in str(g)
        admin.put(f"{API}/admin/settings", json={"mp_access_token": ""})
        assert admin.get(f"{API}/admin/settings").json()["mp_access_token"] == ""

    def test_webhook_invalid_signature(self):
        r = requests.post(f"{API}/billing/webhook?data.id=1", json={"type": "payment", "data": {"id": "1"}},
                          headers={"x-signature": "ts=1,v1=abc"})
        assert r.status_code == 401

    def test_cron(self):
        assert requests.post(f"{API}/cron/tick").status_code == 401
        r = requests.post(f"{API}/cron/tick", headers={"Authorization": f"Bearer {CRON}"})
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("kind", ["clientes", "receita", "assinaturas", "pagamentos", "anuncios_veiculados",
                                      "anuncios_expirados", "solicitacoes", "musicas", "transmissao", "falhas",
                                      "consumo_voz"])
    def test_reports(self, admin, kind):
        r = admin.get(f"{API}/admin/reports/{kind}")
        assert r.status_code == 200, r.text
        c = admin.get(f"{API}/admin/reports/{kind}", params={"format": "csv"})
        assert c.status_code == 200 and "text/csv" in c.headers["content-type"]
