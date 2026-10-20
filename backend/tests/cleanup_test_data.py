# Cleanup helper: archives/deactivates TEST_ data created by test runs (run manually: python cleanup_test_data.py)
import os
import requests

B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
s = requests.Session()
s.post(f"{B}/auth/login", json={"email": "markimagem2014@gmail.com", "password": "Aw@3eszx"})
s.put(f"{B}/admin/settings", json={"mp_access_token": ""})
print("mp token:", repr(s.get(f"{B}/admin/settings").json()["mp_access_token"]))
print("rules:", {k: v for k, v in s.get(f"{B}/admin/programming/rules").json().items() if k in ("every_n", "ads_paused")})
for p in s.get(f"{B}/admin/plans").json():
    if p["name"].startswith("TEST_"):
        s.delete(f"{B}/admin/plans/{p['id']}")
n = 0
for u in s.get(f"{B}/admin/users").json():
    if u["email"].startswith("test_") and u.get("active", True):
        s.patch(f"{B}/admin/users/{u['id']}", json={"active": False})
        n += 1
a = 0
for ad in s.get(f"{B}/admin/ads").json():
    if ad["title"].startswith("TEST_") and not ad["title"].startswith("TEST_Oferta") and ad["status"] != "arquivado":
        s.post(f"{B}/admin/ads/{ad['id']}/status", json={"status": "arquivado", "reason": "cleanup"})
        a += 1
for v in s.get(f"{B}/admin/voice/profiles").json():
    if v["name"].startswith("TEST_"):
        s.delete(f"{B}/admin/voice/profiles/{v['id']}")
print(f"deactivated users={n} archived ads={a}; public plans now:", [p["name"] for p in requests.get(f"{B}/plans").json()])
