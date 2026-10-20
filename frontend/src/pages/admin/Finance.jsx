import { useEffect, useState } from "react";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Empty, NativeSelect, StatCard } from "@/components/common";
import { api } from "@/lib/api";
import { brl, fmtDateTime, LABELS } from "@/lib/format";

export default function Finance() {
  const [rows, setRows] = useState(null);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("");
  useEffect(() => {
    api.get("/admin/payments", { params: { status } }).then((r) => setRows(r.data));
  }, [status]);
  useEffect(() => {
    api.get("/admin/payment-events").then((r) => setEvents(r.data));
  }, []);
  const total = (rows || []).filter((p) => p.status === "aprovado").reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Financeiro" subtitle="Cobranças registradas a partir dos webhooks verificados do Mercado Pago." />
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard testid="finance-total-approved" accent label="Total aprovado (filtro)" value={brl(total)} />
        <StatCard label="Transações" value={rows?.length ?? "—"} />
        <StatCard label="Eventos de webhook" value={events.length} />
      </div>
      <Panel title="Pagamentos">
        <div className="max-w-xs mb-4"><NativeSelect testid="finance-status-filter" value={status} onChange={setStatus}><option value="">Todos</option>{["aprovado", "pendente", "recusado", "estornado"].map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect></div>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhum pagamento registrado.</Empty> : (
          <Table cols={["Data", "Cliente", "Plano", "Valor", "Status", "Detalhe", "Transação"]} testid="finance-payments-table">
            {rows.map((p) => <tr key={p.id}><Td>{fmtDateTime(p.created_at)}</Td><Td className="font-semibold">{p.business_name}</Td><Td>{p.plan_name}</Td><Td>{brl(p.amount)}</Td><Td><StatusBadge status={p.status} /></Td><Td className="text-xs text-slate-400">{p.status_detail}</Td><Td className="font-mono text-xs">{p.mp_payment_id || p.mp_authorized_payment_id}</Td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Eventos recebidos (webhooks)">
        {events.length === 0 ? <Empty>Nenhum evento recebido.</Empty> : (
          <Table cols={["Recebido", "Tópico", "Recurso", "Processado", "Erro"]} testid="finance-events-table">
            {events.map((e) => <tr key={e.event_key}><Td>{fmtDateTime(e.received_at)}</Td><Td className="font-mono text-xs">{e.topic}</Td><Td className="font-mono text-xs">{e.resource_id}</Td><Td>{e.processed ? "Sim" : "Não"}</Td><Td className="text-xs text-red-300">{e.error}</Td></tr>)}
          </Table>
        )}
      </Panel>
    </div>
  );
}
