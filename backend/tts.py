import io
import re
from datetime import datetime

from mutagen.mp3 import MP3
from num2words import num2words

from core import db, NOID, get_settings, now_iso, new_id

MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
          "outubro", "novembro", "dezembro"]
OPENAI_VOICES = ["onyx", "echo", "ash", "sage", "nova", "coral", "shimmer", "alloy", "fable"]
COST_PER_1K = {"openai:tts-1": 0.015, "openai:tts-1-hd": 0.03, "elevenlabs": 0.30}


def _w(n: int) -> str:
    return num2words(n, lang="pt_BR")


def _price(m):
    reais = int(m.group(1).replace(".", ""))
    cents = int(m.group(2)) if m.group(2) else 0
    parts = []
    if reais:
        parts.append(f"{_w(reais)} {'real' if reais == 1 else 'reais'}")
    if cents:
        parts.append(f"{_w(cents)} {'centavo' if cents == 1 else 'centavos'}")
    return " e ".join(parts) or "zero reais"


def _date(m):
    d, mo = int(m.group(1)), int(m.group(2))
    if not (1 <= d <= 31 and 1 <= mo <= 12):
        return m.group(0)
    return f"{'primeiro' if d == 1 else _w(d)} de {MONTHS[mo - 1]}"


def normalize_text(text: str, pronunciations: list, speak_prices=True, speak_dates=True) -> str:
    t = text
    for p in pronunciations or []:
        term, say = (p.get("term") or "").strip(), (p.get("say") or "").strip()
        if term and say:
            t = re.sub(rf"(?<!\w){re.escape(term)}(?!\w)", say, t, flags=re.IGNORECASE)
    if speak_prices:
        t = re.sub(r"R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?", _price, t)
        t = re.sub(r"(\d+)\s?%", lambda m: f"{_w(int(m.group(1)))} por cento", t)
        t = re.sub(r"(\d+)\s?kg\b", lambda m: f"{_w(int(m.group(1)))} {'quilo' if m.group(1) == '1' else 'quilos'}", t)
    if speak_dates:
        t = re.sub(r"\b(\d{1,2})/(\d{1,2})(?:/\d{2,4})?\b", _date, t)
    return t


def apply_pauses(text: str, pause_s: float, provider: str) -> str:
    if pause_s <= 0:
        return text
    sep = f' <break time="{min(pause_s, 3):.1f}s" /> ' if provider == "elevenlabs" else " ... "
    return re.sub(r"([.!?])\s+", r"\1" + sep, text.strip())


def estimate_duration(text: str, speed: float = 1.0, pause_s: float = 0) -> float:
    words = len(text.split())
    sentences = max(1, len(re.findall(r"[.!?]", text)))
    return round(words / 2.6 / max(speed, 0.5) + sentences * pause_s, 1)


def mp3_duration(data: bytes) -> float:
    try:
        return round(MP3(io.BytesIO(data)).info.length, 2)
    except Exception:
        return 0.0


async def voice_options():
    opts = []
    profiles = await db.voice_profiles.find({"deleted": {"$ne": True}}, NOID).to_list(100)
    for p in profiles:
        opts.append({"id": f"profile:{p['id']}", "label": f"Minha Voz MarkImagem — {p['name']}",
                     "provider": "elevenlabs", "provisional": False, "ready": bool(p.get("elevenlabs_voice_id"))})
    for v in OPENAI_VOICES:
        opts.append({"id": f"openai:{v}", "label": f"PROVISÓRIA — voz genérica {v} (OpenAI)", "provider": "openai",
                     "provisional": True, "ready": True})
    return opts


async def synthesize(text: str, voice: str, speed: float = 1.0, pause_s: float = 0.4, stability: float = 0.5,
                     style: float = 0.2, pronunciations=None, speak_prices=True, speak_dates=True):
    """Returns dict(audio, provider, chars, cost_usd, provisional, final_text)."""
    s = await get_settings(secrets=True)
    norm = normalize_text(text, pronunciations or [], speak_prices, speak_dates)
    if voice.startswith("profile:"):
        prof = await db.voice_profiles.find_one({"id": voice.split(":", 1)[1]}, NOID)
        if not prof or not prof.get("elevenlabs_voice_id"):
            raise ValueError("A voz personalizada ainda não foi clonada. Envie amostras e clique em 'Criar voz clonada'.")
        if not s["elevenlabs_api_key"]:
            raise ValueError("Clonagem de voz não configurada: informe a chave ElevenLabs em Configurações.")
        from elevenlabs.client import AsyncElevenLabs
        from elevenlabs import VoiceSettings
        final = apply_pauses(norm, pause_s, "elevenlabs")
        cli = AsyncElevenLabs(api_key=s["elevenlabs_api_key"], timeout=60)
        vs = VoiceSettings(stability=stability, similarity_boost=0.85, style=style, use_speaker_boost=True,
                           speed=max(0.7, min(1.2, speed)))
        audio = b""
        async for chunk in cli.text_to_speech.convert(voice_id=prof["elevenlabs_voice_id"], text=final,
                                                      model_id=s["elevenlabs_model"], voice_settings=vs,
                                                      output_format="mp3_44100_128"):
            audio += chunk
        return {"audio": audio, "provider": "elevenlabs", "chars": len(final), "provisional": False,
                "cost_usd": round(len(final) / 1000 * COST_PER_1K["elevenlabs"], 4), "final_text": final}
    from emergentintegrations.llm.openai import OpenAITextToSpeech
    import os
    vname = voice.split(":", 1)[1] if ":" in voice else "onyx"
    if vname not in OPENAI_VOICES:
        vname = "onyx"
    final = apply_pauses(norm, pause_s, "openai")
    model = s["openai_tts_model"]
    tts = OpenAITextToSpeech(api_key=os.environ["EMERGENT_LLM_KEY"])
    audio = await tts.generate_speech(text=final[:4000], model=model, voice=vname, speed=max(0.5, min(2.0, speed)))
    return {"audio": audio, "provider": f"openai:{model}", "chars": len(final), "provisional": True,
            "cost_usd": round(len(final) / 1000 * COST_PER_1K.get(f"openai:{model}", 0.03), 4), "final_text": final}


async def record_usage(business_id, provider, chars, cost_usd, ad_id=None, user=None, kind="tts"):
    await db.tts_usage.insert_one({"id": new_id(), "business_id": business_id, "provider": provider, "chars": chars,
                                   "cost_usd": cost_usd, "ad_id": ad_id, "kind": kind,
                                   "user_id": (user or {}).get("id"), "month": datetime.now().strftime("%Y-%m"),
                                   "created_at": now_iso()})
