import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Wand2, Save, CheckCircle2, Send, Upload, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Field, Empty, NativeSelect } from "@/components/common";
import { api, errMsg, fileUrl, BACKEND } from "@/lib/api";
import { fmtDate, fmtDateTime, LABELS, WEEKDAYS, AD_STYLES } from "@/lib/format";

const AD_STATUSES = ["rascunho", "aguardando_aprovacao", "aprovado", "agendado", "em_veiculacao", "pausado", "expirado", "rejeitado", "arquivado"];

function CopyAssistant({ businessName, onText }) {
  const [f, setF] = useState({ style: AD_STYLES[0], products: "", extra: "", duration_s: 30 });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    let acc = "";
    try {
      const res = await fetch(`${BACKEND}/api/admin/ai/copy`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, business_name: businessName }) });
      if (!res.ok) throw new Error((await res.json()).detail || "Falha");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const p of parts) {
          const d = p.replace(/^data: /, "");
          if (d === "[DONE]") continue;
          const j = JSON.parse(d);
          if (j.error) throw new Error(j.error);
          acc += j.t;
          onText(acc);
        }
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3" data-testid="ai-copy-assistant">
      <p className="text-sm font-semibold flex items-center gap-2 text-accent"><Sparkles className="w-4 h-4" />Assistente de texto publicitário (Claude)</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <NativeSelect testid="ai-style-select" value={f.style} onChange={(v) => setF({ ...f, style: v })}>{AD_STYLES.map((s) => <option key={s}>{s}</option>)}</NativeSelect>
        <Input data-testid="ai-products-input" className="sm:col-span-2" placeholder="Produtos e preços: Coxão mole R$ 34,90/kg" value={f.products} onChange={(e) => setF({ ...f, products: e.target.value })} />
        <Input className="sm:col-span-2" placeholder="Observações (até sábado, só hoje…)" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} />
        <NativeSelect value={f.duration_s} onChange={(v) => setF({ ...f, duration_s: Number(v) })}>{[15, 20, 30, 45, 60].map((s) => <option key={s} value={s}>~{s} segundos</option>)}</NativeSelect>
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={run} data-testid="ai-generate-copy-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wand2 className="w-4 h-4 mr-1" />}Gerar primeira versão</Button>
    </div>
  );
}

function TtsControls({ p, setP, voices }) {
  const sel = voices.find((v) => v.id === p.voice);
  const setPron = (i, k, v) => setP({ ...p, pronunciations: p.pronunciations.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  return (
    <div className="space-y-4">
      <Field label="Voz selecionada">
        <NativeSelect testid="tts-voice-select" value={p.voice} onChange={(v) => setP({ ...p, voice: v })}>
          {voices.map((v) => <option key={v.id} value={v.id} disabled={!v.ready}>{v.label}{v.ready ? "" : " (não clonada)"}</option>)}
        </NativeSelect>
      </Field>
      {sel?.provisional && <p data-testid="tts-provisional-warning" className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">Voz PROVISÓRIA genérica (OpenAI, sotaque não nativo). Não é a voz oficial MarkImagem. Configure a clonagem em Voz oficial.</p>}
      <Field label={`Velocidade da fala: ${p.speed.toFixed(2)}x`}><Slider data-testid="tts-speed-slider" value={[p.speed * 100]} min={70} max={130} step={5} onValueChange={(v) => setP({ ...p, speed: v[0] / 100 })} /></Field>
      <Field label={`Pausa entre frases: ${p.pause.toFixed(1)}s`}><Slider data-testid="tts-pause-slider" value={[p.pause * 10]} min={0} max={20} step={1} onValueChange={(v) => setP({ ...p, pause: v[0] / 10 })} /></Field>
      {sel?.provider === "elevenlabs" && <>
        <Field label={`Entonação / expressividade: ${p.style.toFixed(2)}`}><Slider value={[p.style * 100]} max={100} step={5} onValueChange={(v) => setP({ ...p, style: v[0] / 100 })} /></Field>
        <Field label={`Estabilidade: ${p.stability.toFixed(2)}`}><Slider value={[p.stability * 100]} max={100} step={5} onValueChange={(v) => setP({ ...p, stability: v[0] / 100 })} /></Field>
      </>}
      <label className="flex items-center gap-3 text-sm"><Switch checked={p.speak_prices} onCheckedChange={(v) => setP({ ...p, speak_prices: v })} data-testid="tts-speak-prices-switch" />Ler preços e números por extenso (R$ 34,90 → trinta e quatro reais e noventa centavos)</label>
      <label className="flex items-center gap-3 text-sm"><Switch checked={p.speak_dates} onCheckedChange={(v) => setP({ ...p, speak_dates: v })} data-testid="tts-speak-dates-switch" />Ler datas por extenso (25/10 → vinte e cinco de outubro)</label>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-slate-400">Pronúncia de nomes comerciais</p>
        {p.pronunciations.map((x, i) => (
          <div key={i} className="flex gap-2"><Input placeholder="Termo (ex.: Hortifruti Bom Preço)" value={x.term} onChange={(e) => setPron(i, "term", e.target.value)} /><Input placeholder="Como falar" value={x.say} onChange={(e) => setPron(i, "say", e.target.value)} />
            <Button type="button" size="icon" variant="ghost" onClick={() => setP({ ...p, pronunciations: p.pronunciations.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button></div>
        ))}
        <Button type="button" size="sm" variant="ghost" data-testid="tts-add-pronunciation-btn" onClick={() => setP({ ...p, pronunciations: [...p.pronunciations, { term: "", say: "" }] })}><Plus className="w-3.5 h-3.5 mr-1" />Adicionar pronúncia</Button>
      </div>
    </div>
  );
}

function AdEditor({ adId, onClose, onSaved, clients, cats, voices, defaultVoice }) {
  const [ad, setAd] = useState(null);
  const [extra, setExtra] = useState({ versions: [], generations: [] });
  const [p, setP] = useState({ voice: defaultVoice, speed: 1, pause: 0.4, stability: 0.5, style: 0.2, pronunciations: [], speak_prices: true, speak_dates: true });
  const [busy, setBusy] = useState("");
  const [norm, setNorm] = useState(null);
  const audioRef = useRef(null);
  const load = useCallback(async () => {
    const { data } = await api.get(`/admin/ads/${adId}`);
    setAd(data.ad);
    setExtra(data);
    if (data.ad.tts_params) setP((x) => ({ ...x, ...data.ad.tts_params }));
  }, [adId]);
  useEffect(() => {
    if (adId) load();
    else setAd(null);
  }, [adId, load]);
  if (!adId) return null;
  const set = (k, v) => setAd({ ...ad, [k]: v });
  const save = async (silent) => {
    const body = { title: ad.title, business_id: ad.business_id || "", category_id: ad.category_id || "", text: ad.text, start_date: ad.start_date || "", end_date: ad.end_date || "", days: ad.days || [], hour_start: ad.hour_start || "", hour_end: ad.hour_end || "", frequency_per_hour: Number(ad.frequency_per_hour), priority: Number(ad.priority), reason: "Edição no editor" };
    const { data } = await api.patch(`/admin/ads/${ad.id}`, body);
    setAd(data);
    if (!silent) toast.success("Rascunho salvo");
    onSaved();
    return data;
  };
  const act = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const generate = () => act("gen", async () => {
    await save(true);
    const { data } = await api.post(`/admin/ads/${ad.id}/generate`, p);
    setAd(data.ad);
    toast.success(data.generation.provisional ? "Áudio gerado com voz PROVISÓRIA" : "Áudio gerado com a voz oficial");
    load();
    onSaved();
    setTimeout(() => audioRef.current?.play().catch(() => {}), 300);
  });
  const status = (st) => act(st, async () => {
    const { data } = await api.post(`/admin/ads/${ad.id}/status`, { status: st });
    setAd(data);
    toast.success(`Status: ${LABELS[data.status]}`);
    onSaved();
  });
  const upload = (e) => act("up", async () => {
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    const { data } = await api.post(`/admin/ads/${ad.id}/upload-audio`, fd);
    setAd(data);
    toast.success("Áudio enviado");
    onSaved();
  });
  const previewNorm = async () => {
    const { data } = await api.post("/admin/tts/normalize", { text: ad.text, pronunciations: p.pronunciations });
    setNorm(data);
  };
  const toggleDay = (i) => set("days", (ad.days || []).includes(i) ? ad.days.filter((d) => d !== i) : [...(ad.days || []), i]);
  return (
    <Dialog open={!!adId} onOpenChange={onClose}>
      <DialogContent className="bg-card max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="ad-editor-dialog">
        {!ad ? <Loading /> : <>
          <DialogHeader><DialogTitle className="flex items-center gap-3 flex-wrap">{ad.title} <StatusBadge testid="ad-editor-status" status={ad.status} /></DialogTitle></DialogHeader>
          <Tabs defaultValue="edit">
            <TabsList><TabsTrigger value="edit" data-testid="ad-tab-edit">Editor</TabsTrigger><TabsTrigger value="hist" data-testid="ad-tab-history">Histórico ({extra.versions.length})</TabsTrigger></TabsList>
            <TabsContent value="edit" className="grid lg:grid-cols-[1.4fr_1fr] gap-6 mt-4">
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Título"><Input data-testid="ad-title-input" value={ad.title} onChange={(e) => set("title", e.target.value)} /></Field>
                  <Field label="Cliente"><NativeSelect testid="ad-client-select" value={ad.business_id || ""} onChange={(v) => set("business_id", v || null)}><option value="">Todas as rádios (institucional)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                  <Field label="Categoria"><NativeSelect testid="ad-category-select" value={ad.category_id || ""} onChange={(v) => set("category_id", v)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                  <Field label="Prioridade (1-5)"><Input type="number" min={1} max={5} value={ad.priority} onChange={(e) => set("priority", e.target.value)} /></Field>
                </div>
                <CopyAssistant businessName={ad.business_name} onText={(t) => set("text", t)} />
                <Field label="Texto do anúncio" hint={`Duração estimada: ~${Math.round((ad.text || "").split(/\s+/).filter(Boolean).length / 2.6 / p.speed + ((ad.text || "").match(/[.!?]/g) || []).length * p.pause)}s`}>
                  <Textarea data-testid="ad-text-input" rows={6} value={ad.text} onChange={(e) => set("text", e.target.value)} />
                </Field>
                <Button type="button" size="sm" variant="ghost" onClick={previewNorm} data-testid="ad-preview-normalized-btn">Ver como será lido</Button>
                {norm && <p className="text-xs text-slate-300 bg-secondary rounded-lg p-3" data-testid="ad-normalized-text">{norm.text}</p>}
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Início da veiculação"><Input data-testid="ad-start-date-input" type="date" value={ad.start_date || ""} onChange={(e) => set("start_date", e.target.value)} /></Field>
                  <Field label="Validade (último dia)"><Input data-testid="ad-end-date-input" type="date" value={ad.end_date || ""} onChange={(e) => set("end_date", e.target.value)} /></Field>
                  <Field label="Horário inicial"><Input type="time" value={ad.hour_start || ""} onChange={(e) => set("hour_start", e.target.value)} /></Field>
                  <Field label="Horário final"><Input type="time" value={ad.hour_end || ""} onChange={(e) => set("hour_end", e.target.value)} /></Field>
                  <Field label="Frequência máxima por hora"><Input type="number" min={0} max={30} value={ad.frequency_per_hour} onChange={(e) => set("frequency_per_hour", e.target.value)} /></Field>
                </div>
                <Field label="Dias permitidos (nenhum = todos)">
                  <div className="flex flex-wrap gap-2">{WEEKDAYS.map((d, i) => <button type="button" key={d} onClick={() => toggleDay(i)} data-testid={`ad-day-${i}`} className={`px-3 py-1.5 rounded-full text-xs border ${(ad.days || []).includes(i) ? "bg-primary border-primary text-white" : "border-border text-slate-400"}`}>{d}</button>)}</div>
                </Field>
              </div>
              <div className="space-y-5">
                <Panel title="Locução">
                  <TtsControls p={p} setP={setP} voices={voices} />
                  <div className="flex flex-wrap gap-2 mt-5">
                    <Button data-testid="tts-generate-btn" disabled={!!busy} onClick={generate}>{busy === "gen" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wand2 className="w-4 h-4 mr-1" />}{ad.audio_file_id ? "Gerar novamente" : "Gerar áudio"}</Button>
                    <label className="inline-flex"><input type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={upload} data-testid="ad-upload-audio-input" /><span className="inline-flex items-center h-10 px-4 rounded-md bg-secondary text-sm cursor-pointer"><Upload className="w-4 h-4 mr-1" />Enviar MP3</span></label>
                  </div>
                </Panel>
                <Panel title="Prévia">
                  {ad.audio_file_id ? <>
                    <audio ref={audioRef} controls src={fileUrl(ad.audio_file_id)} className="w-full" data-testid="ad-audio-preview" />
                    <p className="text-xs text-slate-400 mt-2">Duração: {ad.duration}s • {ad.audio_source === "upload" ? "Enviado" : ad.audio_provisional ? "Voz PROVISÓRIA" : "Voz oficial"}{ad.client_approval_required ? (ad.client_approved_at ? " • Aprovado pelo cliente" : " • Aguardando aprovação do cliente") : ""}</p>
                  </> : <p className="text-sm text-slate-500">Nenhum áudio. Gere ou envie um MP3.</p>}
                </Panel>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={!!busy} onClick={() => act("save", () => save(false))} data-testid="ad-save-draft-btn"><Save className="w-4 h-4 mr-1" />Salvar rascunho</Button>
                  <Button variant="secondary" disabled={!!busy} onClick={() => act("ap", async () => { await save(true); await status("aguardando_aprovacao"); })} data-testid="ad-submit-approval-btn">Enviar p/ aprovação</Button>
                  <Button variant="secondary" disabled={!!busy || !ad.audio_file_id} onClick={() => status("aprovado")} data-testid="ad-approve-btn"><CheckCircle2 className="w-4 h-4 mr-1" />Aprovar anúncio</Button>
                  <Button disabled={!!busy || !ad.audio_file_id} onClick={() => act("pub", async () => { await save(true); await status("publicar"); })} data-testid="ad-publish-btn"><Send className="w-4 h-4 mr-1" />Publicar na programação</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["pausado", "rejeitado", "arquivado"].map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => status(s)} data-testid={`ad-status-${s}-btn`}>{LABELS[s]}</Button>)}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="hist" className="mt-4 space-y-6">
              <div><p className="font-semibold mb-2">Status</p>{(ad.history || []).slice().reverse().map((h, i) => <p key={i} className="text-sm text-slate-300">{fmtDateTime(h.at)} — <StatusBadge status={h.status} /> {h.by} {h.note && `• ${h.note}`}</p>)}</div>
              <div><p className="font-semibold mb-2">Versões (conteúdo anterior → novo)</p>
                {extra.versions.length === 0 ? <Empty>Sem alterações registradas.</Empty> : extra.versions.map((v) => (
                  <div key={v.id} className="rounded-xl border border-border p-3 mb-2 text-xs" data-testid={`ad-version-${v.version}`}>
                    <p className="font-semibold">v{v.version} • {fmtDateTime(v.created_at)} • {v.changed_by} • {v.reason}</p>
                    {v.before.text !== v.after.text && <><p className="text-red-300 mt-1">− {v.before.text}</p><p className="text-emerald-300">+ {v.after.text}</p></>}
                    {(v.before.end_date !== v.after.end_date || v.before.start_date !== v.after.start_date) && <p className="mt-1">Período: {fmtDate(v.before.start_date)}–{fmtDate(v.before.end_date)} → {fmtDate(v.after.start_date)}–{fmtDate(v.after.end_date)}</p>}
                  </div>
                ))}
              </div>
              <div><p className="font-semibold mb-2">Gerações de áudio</p>{extra.generations.map((g) => <p key={g.id} className="text-xs text-slate-400">{fmtDateTime(g.created_at)} • {g.provider} • {g.chars} caracteres • US$ {g.cost_usd}{g.provisional ? " • PROVISÓRIA" : ""}</p>)}</div>
            </TabsContent>
          </Tabs>
        </>}
      </DialogContent>
    </Dialog>
  );
}

export default function Ads() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ status: "", business_id: "", category_id: "" });
  const [clients, setClients] = useState([]);
  const [cats, setCats] = useState([]);
  const [voices, setVoices] = useState({ voices: [], default: "openai:onyx" });
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get("/admin/ads", { params: f }).then((r) => setRows(r.data)), [f]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api.get("/admin/clients").then((r) => setClients(r.data));
    api.get("/categories").then((r) => setCats(r.data));
    api.get("/admin/tts/voices").then((r) => setVoices(r.data));
  }, []);
  const create = async () => {
    try {
      const { data } = await api.post("/admin/ads", { title: "Novo anúncio", text: "" });
      setEdit(data.id);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const catName = (id) => cats.find((c) => c.id === id)?.name || "—";
  return (
    <div>
      <PageHeader title="Anúncios" subtitle="Crie, gere a locução, aprove e publique. A validade é controlada automaticamente.">
        <Button data-testid="new-ad-btn" className="rounded-full" onClick={create}><Plus className="w-4 h-4 mr-1" />Novo anúncio</Button>
      </PageHeader>
      <Panel>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <NativeSelect testid="ads-status-filter" value={f.status} onChange={(v) => setF({ ...f, status: v })}><option value="">Todos os status</option>{AD_STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect>
          <NativeSelect testid="ads-client-filter" value={f.business_id} onChange={(v) => setF({ ...f, business_id: v })}><option value="">Todos os clientes</option><option value="global">Institucional (todas)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          <NativeSelect testid="ads-category-filter" value={f.category_id} onChange={(v) => setF({ ...f, category_id: v })}><option value="">Todas as categorias</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        </div>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhum anúncio.</Empty> : (
          <Table cols={["Título", "Cliente", "Categoria", "Período", "Prioridade", "Execuções", "Status"]} testid="ads-table">
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-secondary/40 cursor-pointer" onClick={() => setEdit(a.id)} data-testid={`ad-row-${a.id}`}>
                <Td className="font-semibold">{a.title}{a.audio_provisional && <span className="ml-2 text-[10px] text-amber-300">PROVISÓRIA</span>}</Td><Td className="text-slate-400">{a.business_name}</Td><Td>{catName(a.category_id)}</Td>
                <Td className="whitespace-nowrap">{fmtDate(a.start_date)} – {fmtDate(a.end_date)}</Td><Td>{a.priority}</Td><Td>{a.play_count || 0}</Td><Td><StatusBadge status={a.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <AdEditor adId={edit} onClose={() => setEdit(null)} onSaved={load} clients={clients} cats={cats} voices={voices.voices} defaultVoice={voices.default} />
    </div>
  );
}
