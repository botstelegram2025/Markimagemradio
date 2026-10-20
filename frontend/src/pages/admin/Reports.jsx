import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Table, Td, Loading, Empty, NativeSelect, Field } from "@/components/common";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { LABELS } from "@/lib/format";

const KINDS = [["clientes", "Clientes ativos por período", false], ["receita", "Receita recorrente", true], ["assinaturas", "Assinaturas", true], ["pagamentos", "Pagamentos aprovados e recusados", true],
  ["anuncios_veiculados", "Anúncios veiculados", false], ["anuncios_expirados", "Anúncios expirados", false], ["solicitacoes", "Solicitações por cliente", false], ["musicas", "Músicas reproduzidas", false],
  ["transmissao", "Tempo total de transmissão", false], ["falhas", "Falhas do streaming", false], ["consumo_voz", "Consumo e custos de geração de áudio / APIs", true]];

export default function Reports() {
  const { user } = useAuth();
  const kinds = KINDS.filter((k) => !k[2] || user.role === "superadmin");
  const [kind, setKind] = useState(kinds[0][0]);
  const [f, setF] = useState({ date_from: "", date_to: "", business_id: "", plan_id: "", category_id: "", status: "" });
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [cats, setCats] = useState([]);
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    api.get("/admin/clients").then((r) => setClients(r.data));
    api.get("/categories").then((r) => setCats(r.data));
    if (user.role === "superadmin") api.get("/admin/plans").then((r) => setPlans(r.data));
  }, [user.role]);
  useEffect(() => {
    setData(null);
    api.get(`/admin/reports/${kind}`, { params: f }).then((r) => setData(r.data));
  }, [kind, f]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const csv = () => downloadFile(`/admin/reports/${kind}?${new URLSearchParams({ ...f, format: "csv" })}`, `relatorio-${kind}.csv`);
  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios" subtitle="Filtre por data, cliente, plano, categoria e status. Exporte em CSV.">
        <Button data-testid="report-export-csv-btn" variant="secondary" onClick={csv}><Download className="w-4 h-4 mr-1" />Exportar CSV</Button>
      </PageHeader>
      <Panel>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2"><Field label="Relatório"><NativeSelect testid="report-kind-select" value={kind} onChange={setKind}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field></div>
          <Field label="De"><Input data-testid="report-date-from" type="date" value={f.date_from} onChange={(e) => set("date_from")(e.target.value)} /></Field>
          <Field label="Até"><Input data-testid="report-date-to" type="date" value={f.date_to} onChange={(e) => set("date_to")(e.target.value)} /></Field>
          <Field label="Cliente"><NativeSelect testid="report-client-filter" value={f.business_id} onChange={set("business_id")}><option value="">Todos</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          {plans.length > 0 && <Field label="Plano"><NativeSelect value={f.plan_id} onChange={set("plan_id")}><option value="">Todos</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>}
          <Field label="Categoria"><NativeSelect value={f.category_id} onChange={set("category_id")}><option value="">Todas</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Status"><NativeSelect testid="report-status-filter" value={f.status} onChange={set("status")}><option value="">Todos</option>{["ativa", "inadimplente", "cancelada", "aprovado", "recusado", "pendente", "recebida", "concluida"].map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect></Field>
        </div>
      </Panel>
      <Panel>
        {!data ? <Loading /> : data.rows.length === 0 ? <Empty>Sem dados para os filtros.</Empty> : (
          <Table cols={data.columns} testid="report-table">
            {data.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <Td key={j}>{typeof c === "number" ? c.toLocaleString("pt-BR") : c}</Td>)}</tr>)}
          </Table>
        )}
      </Panel>
    </div>
  );
}
