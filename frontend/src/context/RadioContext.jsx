import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api, errMsg, mediaUrl } from "@/lib/api";

const RadioCtx = createContext(null);

// Client-side transport for the server-side per-business programming engine.
export function RadioProvider({ businessId = null, children }) {
  const audio = useRef(null);
  const [item, setItem] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [conn, setConn] = useState("idle"); // idle | connecting | live | buffering | reconnecting | error
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("mk_vol") || 0.8));
  const [progress, setProgress] = useState(0);
  const wantPlay = useRef(false);
  const retries = useRef(0);

  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    a.crossOrigin = "use-credentials";
    audio.current = a;
    return () => {
      a.pause();
      a.src = "";
    };
  }, []);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
    localStorage.setItem("mk_vol", String(volume));
  }, [volume]);

  const report = useCallback((type, message) => {
    api.post("/radio/event", { type, message, business_id: businessId }).catch(() => {});
  }, [businessId]);

  const loadNext = useCallback(async () => {
    const a = audio.current;
    if (!a || !wantPlay.current) return;
    setConn((c) => (c === "live" ? "buffering" : c === "reconnecting" ? c : "connecting"));
    try {
      const { data } = await api.post("/radio/next", null, { params: businessId ? { business_id: businessId } : {} });
      setItem(data);
      setError("");
      a.src = mediaUrl(data.media_url);
      await a.play();
      retries.current = 0;
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: data.title, artist: data.type === "ad" ? `Anúncio • ${data.artist}` : data.artist, album: "MarkImagem Rádio Web",
        });
      }
    } catch (e) {
      const status = e?.response?.status;
      if (status === 402 || status === 409 || status === 403 || status === 400) {
        wantPlay.current = false;
        setPlaying(false);
        setConn("error");
        setError(errMsg(e));
        return;
      }
      retries.current += 1;
      setConn("reconnecting");
      setError(navigator.onLine ? "Instabilidade na conexão. Reconectando…" : "Sem conexão com a internet. Aguardando retorno…");
      report("error", `next: ${e?.message || status}`);
      setTimeout(() => loadNext(), Math.min(15000, 1500 * retries.current));
    }
  }, [businessId, report]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return undefined;
    const onEnded = () => loadNext();
    const onPlaying = () => { setConn("live"); setPlaying(true); setError(""); };
    const onWaiting = () => setConn("buffering");
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onErr = () => {
      if (!wantPlay.current) return;
      report("error", `media error ${a.error?.code || ""}`);
      setConn("reconnecting");
      retries.current += 1;
      setTimeout(() => {
        if (!wantPlay.current) return;
        const t = a.currentTime;
        if (retries.current <= 2 && a.src) {
          a.load();
          a.currentTime = t;
          a.play().catch(() => loadNext());
        } else loadNext();
      }, 1500);
    };
    const onOnline = () => {
      if (wantPlay.current && a.paused) {
        report("reconnect", "online");
        a.play().catch(() => loadNext());
      }
    };
    a.addEventListener("ended", onEnded);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("waiting", onWaiting);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("error", onErr);
    window.addEventListener("online", onOnline);
    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("waiting", onWaiting);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("error", onErr);
      window.removeEventListener("online", onOnline);
    };
  }, [loadNext, report]);

  const play = async () => {
    wantPlay.current = true;
    setError("");
    const a = audio.current;
    if (a.src && item) {
      setConn("buffering");
      try {
        await a.play();
        return;
      } catch {
        /* fall through to next item */
      }
    }
    loadNext();
  };
  const pause = () => {
    wantPlay.current = false;
    audio.current?.pause();
    setPlaying(false);
    setConn("idle");
  };
  const toggle = () => (playing || conn === "connecting" || conn === "buffering" ? pause() : play());

  return (
    <RadioCtx.Provider value={{ item, playing, conn, error, volume, setVolume, toggle, play, pause, progress }}>
      {children}
    </RadioCtx.Provider>
  );
}

export const useRadio = () => useContext(RadioCtx);
