import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Upload, FileArchive, RefreshCw, ShieldCheck, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Field, Empty, NativeSelect } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime, fmtDur, LABELS } from "@/lib/format";

function Importer({ onDone }) {
  const [genre, setGenre] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const send = async (files, zip) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    if (zip) fd.append("file", files[0]);
    else Array.from(files).forEach((f) => fd.append("files", f));
    fd.append("genre", genre);
    fd.append("package_name", name);
    try {
      const { data } = await api.post(zip ? "/admin/music/upload-zip" : "/admin/music/upload", fd, { timeout: 600000 });
      setResult(data);
      toast.success(`${data.accepted} música(s) importada(s)`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Importar músicas autorizadas">
      <p className="text-xs text-slate-400 mb-4 flex gap-2"><ShieldCheck className="w-4 h-4 text-primary shrink-0" />Importe apenas músicas licenciadas para execução pública comercial no Brasil (ECAD/licenças aplicáveis). Não use downloads de plataformas de streaming.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nome do pacote (opcional)"><Input data-testid="music-package-name-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Gênero / categoria musical (opcional)"><Input data-testid="music-genre-input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Ex.: Sertanejo, Pop, MPB" /></Field>
      </div>
      <div className="flex flex-wrap gap-3 mt-4">
        <label><input type="file" multiple accept=".mp3,audio/mpeg" className="hidden" disabled={busy} onChange={(e) => send(e.target.files, false)} data-testid="music-upload-files-input" /><span className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-white text-sm cursor-pointer"><Upload className="w-4 h-4 mr-2" />{busy ? "Processando…" : "Enviar MP3 (lote)"}</span></label>
        <label><input type="file" accept=".zip" className="hidden" disabled={busy} onChange={(e) => send(e.target.files, true)} data-testid="music-upload-zip-input" /><span className="inline-flex items-center h-10 px-4 rounded-md bg-secondary text-sm cursor-pointer"><FileArchive className="w-4 h-4 mr-2" />Enviar pacote ZIP</span></label>
      </div>
      {result && (
        <div className="mt-4 text-sm rounded-xl border border-border p-4" data-testid="music-import-result">
          <p><strong>{result.accepted}</strong> aceitas • <strong>{result.duplicates.length}</strong> duplicadas • <strong>{result.rejected.length}</strong> rejeitadas • duração {fmtDur(result.total_duration)} • playlist v{result.playlist_version}</p>
          {result.rejected.map((r, i) => <p key={i} className="text-xs text-red-300">✕ {r.file}: {r.reason}</p>)}
          {result.duplicates.map((r, i) => <p key={i} className="text-xs text-amber-300">≡ {r.file}: {r.reason}</p>)}
        </div>
      )}
    </Panel>
  );
}

function Tracks({ tick }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ q: "", status: "", genre: "" });
  const load = useCallback(() => api.get("/admin/music/tracks", { params: f }).then((r) => setD(r.data)), [f]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, tick]);
  const setStatus = async (t, status) => {
    try {
      if (status === "excluida") await api.delete(`/admin/music/tracks/${t.id}`);
      else await api.patch(`/admin/music/tracks/${t.id}`, { status });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Panel>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <Input data-testid="tracks-search-input" placeholder="Buscar título ou artista" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <NativeSelect testid="tracks-status-filter" value={f.status} onChange={(v) => setF({ ...f, status: v })}><option value="">Todos os status</option>{["ativa", "pausada", "retirada", "indisponivel"].map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect>
        <NativeSelect value={f.genre} onChange={(v) => setF({ ...f, genre: v })}><option value="">Todos os gêneros</option>{(d?.genres || []).map((g) => <option key={g}>{g}</option>)}</NativeSelect>
      </div>
      {!d ? <Loading /> : d.tracks.length === 0 ? <Empty>Nenhuma música. Importe um pacote acima.</Empty> : (
        <Table cols={["Título", "Artista", "Duração", "Gênero", "Origem", "Execuções", "Status", "Ações"]} testid="tracks-table">
          {d.tracks.map((t) => (
            <tr key={t.id} data-testid={`track-row-${t.id}`}>
              <Td className="font-semibold">{t.title}</Td><Td className="text-slate-400">{t.artist}</Td><Td className="font-mono text-xs">{fmtDur(t.duration)}</Td><Td>{t.genre}</Td>
              <Td className="text-xs text-slate-500 max-w-[160px] truncate">{t.source_filename}</Td><Td>{t.play_count}</Td><Td><StatusBadge status={t.status} /></Td>
              <Td><NativeSelect className="h-8 w-32" testid={`track-action-${t.id}`} value="" onChange={(v) => v && setStatus(t, v)}><option value="">Alterar…</option><option value="ativa">Ativar</option><option value="pausada">Pausar</option><option value="retirada">Retirar</option><option value="excluida">Excluir</option></NativeSelect></Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function Packages({ tick }) {
  const [rows, setRows] = useState(null);
  const [dups, setDups] = useState([]);
  useEffect(() => {
    api.get("/admin/music/packages").then((r) => setRows(r.data));
    api.get("/admin/music/duplicates").then((r) => setDups(r.data));
  }, [tick]);
  return (
    <div className="space-y-6">
      <Panel title="Histórico de importações (o pacote mais recente tem prioridade)">
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhum pacote importado.</Empty> : (
          <Table cols={["Data", "Pacote", "Origem", "Faixas", "Duração", "Rejeitadas", "Duplicadas"]} testid="packages-table">
            {rows.map((p) => <tr key={p.id}><Td>{fmtDateTime(p.created_at)}</Td><Td className="font-semibold">{p.name}</Td><Td>{p.source.toUpperCase()}</Td><Td>{p.track_ids.length}</Td><Td>{fmtDur(p.total_duration)}</Td><Td>{p.rejected.length}</Td><Td>{p.duplicates.length}</Td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><Copy className="w-4 h-4" />Possíveis duplicadas (mesmo título e artista)</span>}>
        {dups.length === 0 ? <p className="text-sm text-slate-500">Nenhuma duplicidade encontrada.</p> : dups.map((g, i) => <p key={i} className="text-sm py-1">{g.title} — {g.artist} <span className="text-slate-500">({g.tracks.length} cópias)</span></p>)}
      </Panel>
    </div>
  );
}

export default function Music() {
  const [tick, setTick] = useState(0);
  const verify = async () => {
    try {
      const { data } = await api.post("/admin/music/verify");
      toast.success(`${data.checked} verificadas • ${data.missing} indisponíveis`);
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Biblioteca musical" subtitle="Importação, metadados, duplicidades e verificação de arquivos.">
        <Button data-testid="music-verify-btn" variant="secondary" onClick={verify}><RefreshCw className="w-4 h-4 mr-1" />Verificar arquivos</Button>
      </PageHeader>
      <Importer onDone={() => setTick((t) => t + 1)} />
      <Tabs defaultValue="tracks">
        <TabsList className="mb-4"><TabsTrigger value="tracks" data-testid="tab-tracks">Músicas</TabsTrigger><TabsTrigger value="packages" data-testid="tab-packages">Pacotes e duplicadas</TabsTrigger></TabsList>
        <TabsContent value="tracks"><Tracks tick={tick} /></TabsContent>
        <TabsContent value="packages"><Packages tick={tick} /></TabsContent>
      </Tabs>
    </div>
  );
}
