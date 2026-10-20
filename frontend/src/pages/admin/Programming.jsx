import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, Table, Td, Loading, Empty, NativeSelect, StatCard } from "@/components/common";
import { RadioProvider } from "@/context/RadioContext";
import RadioPlayer from "@/components/RadioPlayer";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime, fmtDur } from "@/lib/format";

export default function Programming() {
  const [d, setD] = useState(null);
  const [versions, setVersions] = useState([]);
  const [clients, setClients] = useState([]);
  const [biz, setBiz] = useState("");
  const [hist, setHist] = useState([]);
  const load = useCallback(async () => {
    const [a, v] = await Promise.all([api.get("/admin/playlists/active"), api.get("/admin/playlists")]);
    setD(a.data);
    setVersions(v.data);
  }, []);
  useEffect(() => {
    load();
    api.get("/admin/clients").then((r) => setClients(r.data));
  }, [load]);
  useEffect(() => {
    api.get("/admin/playback", { params: { business_id: biz } }).then((r) => setHist(r.data));
  }, [biz]);
  const rebuild = async () => {
    try {
      const { data } = await api.post("/admin/playlists/build");
      toast.success(`Playlist v${data.version} gerada (${fmtDur(data.total_duration)})`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (!d) return <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader title="Programação da rádio" subtitle="Playlist ativa de até 12 horas: pacote mais recente primeiro, completada com pacotes anteriores sem duplicar faixas.">
        <Button data-testid="playlist-rebuild-btn" variant="secondary" onClick={rebuild}><RefreshCw className="w-4 h-4 mr-1" />Reconstruir playlist</Button>
      </PageHeader>
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard testid="playlist-version" label="Versão ativa" value={d.playlist ? `v${d.playlist.version}` : "—"} hint={d.playlist?.reason} />
        <StatCard testid="playlist-duration" label="Duração total" value={d.playlist ? fmtDur(d.playlist.total_duration) : "—"} hint="Limite: 12h" />
        <StatCard testid="playlist-tracks" label="Faixas" value={d.items.length} />
      </div>
      <Panel title="Ouvir a rádio de um estabelecimento (monitoramento)">
        <div className="max-w-sm mb-4"><NativeSelect testid="programming-business-select" value={biz} onChange={setBiz}><option value="">Selecione o cliente…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
        {biz && <RadioProvider key={biz} businessId={biz}><RadioPlayer stationName={`Monitorando: ${clients.find((c) => c.id === biz)?.name}`} /></RadioProvider>}
      </Panel>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Sequência da playlist ativa">
          {d.items.length === 0 ? <Empty>Playlist vazia. Importe músicas na Biblioteca.</Empty> : (
            <div className="max-h-[480px] overflow-y-auto"><Table cols={["#", "Título", "Artista", "Duração"]} testid="playlist-items-table">
              {d.items.map((t, i) => <tr key={t.id}><Td className="text-slate-500 font-mono text-xs">{i + 1}</Td><Td className="font-medium">{t.title}</Td><Td className="text-slate-400">{t.artist}</Td><Td className="font-mono text-xs">{fmtDur(t.duration)}</Td></tr>)}
            </Table></div>
          )}
        </Panel>
        <Panel title="Histórico de reprodução">
          {hist.length === 0 ? <Empty>Sem reproduções.</Empty> : (
            <div className="max-h-[480px] overflow-y-auto"><Table cols={["Horário", "Tipo", "Título"]} testid="playback-history-table">
              {hist.map((h) => <tr key={h.id}><Td className="text-xs whitespace-nowrap">{fmtDateTime(h.started_at)}</Td><Td>{h.type === "ad" ? <span className="text-accent">Anúncio</span> : "Música"}</Td><Td>{h.title}</Td></tr>)}
            </Table></div>
          )}
        </Panel>
      </div>
      <Panel title="Versões da programação">
        <Table cols={["Versão", "Criada em", "Faixas / duração", "Motivo", "Ativa"]} testid="playlist-versions-table">
          {versions.map((v) => <tr key={v.id}><Td>v{v.version}</Td><Td>{fmtDateTime(v.created_at)}</Td><Td>{fmtDur(v.total_duration)}</Td><Td className="text-slate-400">{v.reason}</Td><Td>{v.active ? "Sim" : ""}</Td></tr>)}
        </Table>
      </Panel>
    </div>
  );
}
