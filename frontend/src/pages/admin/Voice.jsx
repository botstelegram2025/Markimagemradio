import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Square, RotateCcw, Save, Trash2, Upload, Wand2, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader, Panel, StatusBadge, Loading, Field, Empty, NativeSelect } from "@/components/common";
import { api, errMsg, fileUrl } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

const CONSENT = "Eu, titular da voz, autorizo expressamente a MarkImagem a utilizar minhas gravações para criar e utilizar um modelo de voz sintética exclusivamente na produção de anúncios da plataforma MarkImagem Rádio Web, podendo revogar esta autorização e solicitar a exclusão das gravações a qualquer momento.";

function Recorder({ profileId, onSaved }) {
  const [state, setState] = useState("idle");
  const [blob, setBlob] = useState(null);
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = () => {
        setBlob(new Blob(chunks.current, { type: r.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      r.start();
      rec.current = r;
      setSecs(0);
      setBlob(null);
      setState("rec");
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  };
  const pause = () => {
    rec.current.pause();
    clearInterval(timer.current);
    setState("paused");
  };
  const resume = () => {
    rec.current.resume();
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    setState("rec");
  };
  const stop = () => {
    rec.current.stop();
    clearInterval(timer.current);
    setState("done");
  };
  const save = async () => {
    const fd = new FormData();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    fd.append("file", new File([blob], `gravacao-${Date.now()}.${ext}`, { type: blob.type.split(";")[0] }));
    fd.append("label", `Gravação no navegador (${secs}s)`);
    try {
      await api.post(`/admin/voice/profiles/${profileId}/recordings`, fd);
      toast.success("Gravação salva");
      setBlob(null);
      setState("idle");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="rounded-2xl border border-border bg-[#0f1522] p-5" data-testid="voice-recorder">
      <div className="flex items-center gap-4">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${state === "rec" ? "bg-red-600 onair-dot" : "bg-secondary"}`}><Mic className="w-6 h-6" /></div>
        <div><p className="font-semibold">{state === "rec" ? "Gravando…" : state === "paused" ? "Pausado" : state === "done" ? "Gravação pronta" : "Pronto para gravar"}</p><p className="font-mono text-sm text-slate-400" data-testid="voice-recorder-timer">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</p></div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {(state === "idle" || state === "done") && <Button data-testid="voice-record-btn" onClick={start}>{state === "done" ? <RotateCcw className="w-4 h-4 mr-1" /> : <Mic className="w-4 h-4 mr-1" />}{state === "done" ? "Gravar novamente" : "Iniciar gravação"}</Button>}
        {state === "rec" && <Button data-testid="voice-pause-btn" variant="secondary" onClick={pause}><Pause className="w-4 h-4 mr-1" />Pausar</Button>}
        {state === "paused" && <Button data-testid="voice-resume-btn" variant="secondary" onClick={resume}><Play className="w-4 h-4 mr-1" />Continuar</Button>}
        {(state === "rec" || state === "paused") && <Button data-testid="voice-stop-btn" variant="secondary" onClick={stop}><Square className="w-4 h-4 mr-1" />Finalizar</Button>}
      </div>
      {blob && <div className="mt-4 space-y-3"><audio controls src={URL.createObjectURL(blob)} className="w-full" data-testid="voice-recording-preview" /><Button data-testid="voice-save-recording-btn" onClick={save}><Save className="w-4 h-4 mr-1" />Salvar gravação</Button></div>}
      <p className="text-xs text-slate-500 mt-4">Dica: grave em ambiente silencioso, 1 a 3 minutos no total, lendo anúncios no seu estilo natural.</p>
    </div>
  );
}

function VoiceTest({ voices }) {
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("Atenção, clientes! Hoje tem oferta especial no Açougue do João. Coxão mole por apenas R$ 34,90 o quilo. Aproveite, porque é somente até sábado!");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!voice && voices.length) setVoice(voices.find((v) => v.ready)?.id || "");
  }, [voices, voice]);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/voice/test", { voice, text });
      setRes(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Testar qualidade da voz">
      <div className="space-y-3">
        <NativeSelect testid="voice-test-select" value={voice} onChange={setVoice}>{voices.map((v) => <option key={v.id} value={v.id} disabled={!v.ready}>{v.label}{v.ready ? "" : " (não clonada)"}</option>)}</NativeSelect>
        <Textarea data-testid="voice-test-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        <Button data-testid="voice-test-btn" disabled={busy || !voice} onClick={run}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wand2 className="w-4 h-4 mr-1" />}Gerar teste</Button>
        {res && <><audio controls autoPlay src={fileUrl(res.file_id)} className="w-full" data-testid="voice-test-audio" /><p className="text-xs text-slate-400">{res.provisional ? "Voz PROVISÓRIA genérica (OpenAI)" : "Voz clonada (ElevenLabs)"}</p></>}
      </div>
    </Panel>
  );
}

export default function Voice() {
  const [profiles, setProfiles] = useState(null);
  const [info, setInfo] = useState({ voices: [], elevenlabs_configured: false });
  const [f, setF] = useState({ name: "", consent: false });
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const [p, v] = await Promise.all([api.get("/admin/voice/profiles"), api.get("/admin/tts/voices")]);
    setProfiles(p.data);
    setInfo(v.data);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/admin/voice/profiles", { name: f.name, consent: f.consent, consent_text: CONSENT });
      setF({ name: "", consent: false });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const upload = async (pid, e) => {
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    fd.append("label", e.target.files[0].name);
    try {
      await api.post(`/admin/voice/profiles/${pid}/recordings`, fd);
      toast.success("Amostra enviada");
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const clone = async (pid) => {
    setBusy(pid);
    try {
      await api.post(`/admin/voice/profiles/${pid}/clone`);
      toast.success("Voz clonada com sucesso!");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const del = async (url, msg) => {
    if (!window.confirm(msg)) return;
    await api.delete(url);
    load();
  };
  if (!profiles) return <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader title="Minha Voz MarkImagem" subtitle="Grave sua voz, autorize o uso e crie a voz sintética oficial para os anúncios." />
      {!info.elevenlabs_configured && (
        <div data-testid="voice-clone-not-configured-alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>Clonagem de voz NÃO configurada.</strong> As gravações podem ser feitas e armazenadas agora, mas a voz clonada só é criada após informar a chave ElevenLabs em Configurações. Até lá, os anúncios usam uma voz PROVISÓRIA genérica, sempre identificada como tal.
        </div>
      )}
      <Panel title="Novo perfil de voz">
        <form onSubmit={create} className="space-y-4" data-testid="voice-profile-form">
          <Field label="Nome do perfil"><Input data-testid="voice-profile-name-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Voz oficial — Mark" /></Field>
          <label className="flex items-start gap-3 text-sm text-slate-300 rounded-xl border border-border p-4"><Checkbox data-testid="voice-consent-checkbox" checked={f.consent} onCheckedChange={(v) => setF({ ...f, consent: !!v })} className="mt-0.5" /><span><ShieldCheck className="inline w-4 h-4 text-primary mr-1" />{CONSENT}</span></label>
          <Button data-testid="voice-profile-create-btn" disabled={!f.consent}>Criar perfil com autorização</Button>
        </form>
      </Panel>
      {profiles.length === 0 && <Empty>Nenhum perfil de voz criado.</Empty>}
      {profiles.map((p) => (
        <Panel key={p.id} testid={`voice-profile-${p.id}`} title={<span className="flex items-center gap-3">{p.name} <StatusBadge status={p.status === "clonada" ? "ativa" : p.status === "erro" ? "rejeitado" : "pendente"} /></span>}
          action={<Button size="sm" variant="ghost" className="text-red-400" onClick={() => del(`/admin/voice/profiles/${p.id}`, "Excluir perfil, gravações e voz clonada?")} data-testid={`voice-profile-delete-${p.id}`}><Trash2 className="w-4 h-4" /></Button>}>
          <p className="text-xs text-slate-500 mb-4">Autorizado por {p.consent?.by} em {fmtDateTime(p.consent?.at)} • {p.status === "clonada" ? "Voz clonada pronta para uso" : p.status === "erro" ? `Erro: ${p.last_error}` : "Aguardando clonagem"}</p>
          <div className="grid lg:grid-cols-2 gap-6">
            <Recorder profileId={p.id} onSaved={load} />
            <div className="space-y-3">
              <label className="inline-flex"><input type="file" accept="audio/*" className="hidden" onChange={(e) => upload(p.id, e)} data-testid={`voice-upload-input-${p.id}`} /><span className="inline-flex items-center h-9 px-3 rounded-md bg-secondary text-sm cursor-pointer"><Upload className="w-4 h-4 mr-1" />Enviar arquivo gravado externamente</span></label>
              {p.recordings.length === 0 ? <p className="text-sm text-slate-500">Nenhuma amostra.</p> : p.recordings.map((r) => (
                <div key={r.id} className="flex items-center gap-2" data-testid={`voice-recording-${r.id}`}>
                  <audio controls preload="none" src={fileUrl(r.file_id)} className="flex-1 h-9" />
                  <Button size="icon" variant="ghost" onClick={() => del(`/admin/voice/recordings/${r.id}`, "Excluir esta gravação?")}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button data-testid={`voice-clone-btn-${p.id}`} disabled={busy === p.id || p.recordings.length === 0} onClick={() => clone(p.id)}>{busy === p.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wand2 className="w-4 h-4 mr-1" />}{p.elevenlabs_voice_id ? "Recriar voz clonada" : "Criar voz clonada"}</Button>
            </div>
          </div>
        </Panel>
      ))}
      <VoiceTest voices={info.voices} />
    </div>
  );
}
