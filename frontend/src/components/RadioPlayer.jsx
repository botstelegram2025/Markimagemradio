import { Play, Pause, Loader2, Volume2, VolumeX, Wifi, WifiOff, Megaphone, Music2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useRadio } from "@/context/RadioContext";
import { mediaUrl } from "@/lib/api";
import { fmtDur } from "@/lib/format";

const CONN = {
  idle: ["Pronta para tocar", "text-slate-400"],
  connecting: ["Conectando…", "text-amber-300"],
  buffering: ["Carregando…", "text-amber-300"],
  live: ["Conectado", "text-emerald-400"],
  reconnecting: ["Reconectando…", "text-amber-300"],
  error: ["Indisponível", "text-red-400"],
};

export const Equalizer = ({ active }) => (
  <div className={`flex items-end gap-[3px] h-6 ${active ? "" : "eq-paused"}`} aria-hidden>
    {[0, 1, 2, 3].map((i) => <span key={i} className="eq-bar h-full" />)}
  </div>
);

export const PlayButton = ({ size = "lg" }) => {
  const { playing, conn, toggle } = useRadio();
  const loading = conn === "connecting" || conn === "buffering" || conn === "reconnecting";
  const dim = size === "lg" ? "w-24 h-24" : "w-11 h-11";
  const ic = size === "lg" ? "w-10 h-10" : "w-5 h-5";
  return (
    <button
      data-testid={size === "lg" ? "radio-player-play-pause-btn" : "mini-player-play-pause-btn"}
      onClick={toggle}
      aria-label={playing ? "Pausar rádio" : "Tocar rádio"}
      className={`${dim} shrink-0 rounded-full bg-primary text-white flex items-center justify-center shadow-lg shadow-red-600/40 hover:scale-105 active:scale-95 transition-transform`}
    >
      {loading && playing === false && conn !== "idle" ? <Loader2 className={`${ic} animate-spin`} /> : playing ? <Pause className={ic} /> : <Play className={`${ic} ml-1`} />}
    </button>
  );
};

const VolumeControl = () => {
  const { volume, setVolume } = useRadio();
  return (
    <div className="flex items-center gap-3 w-full max-w-[220px]">
      <button data-testid="radio-mute-btn" aria-label="Silenciar" onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="text-slate-300 hover:text-white">
        {volume > 0 ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
      </button>
      <Slider data-testid="radio-player-volume-slider" value={[Math.round(volume * 100)]} max={100} step={1} onValueChange={(v) => setVolume(v[0] / 100)} aria-label="Volume" />
    </div>
  );
};

export default function RadioPlayer({ stationName = "Minha Rádio" }) {
  const { item, playing, conn, error, progress } = useRadio();
  const [label, color] = CONN[conn];
  const isAd = item?.type === "ad";
  return (
    <div data-testid="radio-player" className="grain relative overflow-hidden rounded-3xl border border-border bg-[#0f1522] p-6 sm:p-8">
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex flex-col sm:flex-row gap-6 sm:items-center">
        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl bg-secondary overflow-hidden flex items-center justify-center shrink-0 border border-border">
          {item?.cover_url ? <img src={mediaUrl(item.cover_url)} alt="Capa" className="w-full h-full object-cover" />
            : isAd ? <Megaphone className="w-12 h-12 text-accent" /> : <Music2 className="w-12 h-12 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {playing && conn === "live" ? (
              <span data-testid="radio-onair-badge" className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30">
                <span className="w-2 h-2 rounded-full bg-red-500 onair-dot" /> No ar
              </span>
            ) : null}
            <span data-testid="radio-connection-status" className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color}`}>
              {conn === "error" || conn === "reconnecting" ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />} {label}
            </span>
            {isAd && <span data-testid="radio-current-ad-badge" className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-accent text-accent-foreground">Anúncio</span>}
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{stationName}</p>
          <h2 data-testid="radio-now-playing-title" className="text-2xl sm:text-3xl font-bold truncate">{item?.title || "Aperte o play para começar"}</h2>
          <p data-testid="radio-now-playing-artist" className="text-slate-400 truncate">{item ? item.artist : "Programação musical com seus anúncios"}</p>
          <div className="h-1 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${progress * 100}%` }} /></div>
          {item && <p className="text-xs text-slate-500 font-mono">{fmtDur(item.duration)}</p>}
        </div>
      </div>
      <div className="relative mt-6 flex flex-col sm:flex-row items-center gap-6">
        <PlayButton />
        <Equalizer active={playing && conn === "live"} />
        <VolumeControl />
      </div>
      {error && <p data-testid="radio-error-message" role="alert" className="relative mt-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}

export function MiniPlayer() {
  const { item, playing, conn } = useRadio();
  return (
    <div data-testid="mini-player" className="flex items-center gap-3 min-w-0">
      <PlayButton size="sm" />
      <div className="min-w-0 hidden sm:block">
        <p className="text-sm font-semibold truncate max-w-[220px]">{item?.title || "Minha Rádio"}</p>
        <p className="text-xs text-slate-400 truncate max-w-[220px]">{item ? (item.type === "ad" ? "Anúncio" : item.artist) : CONN[conn][0]}</p>
      </div>
      <Equalizer active={playing && conn === "live"} />
    </div>
  );
}
