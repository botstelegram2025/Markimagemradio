import { useEffect, useState } from "react";
import { PageHeader, Panel, Table, Td, Empty, Loading, NativeSelect } from "@/components/common";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fmtDateTime, fmtDur } from "@/lib/format";

export default function ClientHistory() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ type: "", date_from: "", date_to: "" });
  useEffect(() => {
    api.get("/client/history", { params: f }).then((r) => setRows(r.data));
  }, [f]);
  return (
    <div>
      <PageHeader title="Histórico de veiculação" subtitle="Músicas e anúncios reproduzidos na sua rádio." />
      <Panel>
        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          <NativeSelect testid="history-type-filter" value={f.type} onChange={(v) => setF({ ...f, type: v })}>
            <option value="">Tudo</option><option value="ad">Anúncios</option><option value="music">Músicas</option>
          </NativeSelect>
          <Input data-testid="history-date-from" type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} />
          <Input data-testid="history-date-to" type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} />
        </div>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhuma reprodução no período.</Empty> : (
          <Table cols={["Horário", "Tipo", "Título", "Artista / Origem", "Duração"]} testid="client-history-table">
            {rows.map((h) => (
              <tr key={h.id}>
                <Td>{fmtDateTime(h.started_at)}</Td>
                <Td>{h.type === "ad" ? <span className="text-accent font-semibold">Anúncio</span> : "Música"}</Td>
                <Td className="font-medium">{h.title}</Td><Td className="text-slate-400">{h.artist}</Td><Td className="font-mono text-xs">{fmtDur(h.duration)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
