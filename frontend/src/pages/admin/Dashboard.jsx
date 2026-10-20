import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, UserPlus, Wallet, Megaphone, Library, Inbox, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { PageHeader, StatCard, Panel, Loading, StatusBadge } from "@/components/common";
import { api } from "@/lib/api";
import { brl, fmtDate, fmtDateTime, fmtDur } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";

const SERVICES = [["storage", "Armazenamento de áudio"], ["tts_provisional", "Voz provisória (OpenAI)"], ["voice_clone", "Clonagem de voz (ElevenLabs)"], ["mercadopago", "Mercado Pago"], ["webhook_secret", "Webhook Mercado Pago"], ["email", "E-mail de notificações"]];

const Service = ({ ok, label }) => (
  <li className="flex items-center justify-between py-2 text-sm">
    <span>{label}</span>
    {ok ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-4 h-4" />Ativo</span> : <span className="flex items-center gap-1 text-amber-300"><XCircle className="w-4 h-4" />Não configurado</span>}
  </li>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const { user } = useAuth();
  useEffect(() => {
    api.get("/admin/dashboard").then((r) => setD(r.data));
  }, []);
  if (!d) return <Loading />;
  const s = d.subscriptions;
  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle={`Bem-vindo, ${user.name}. Visão geral da operação MarkImagem Rádio Web.`} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-clients-active" label="Clientes ativos" value={d.clients_active} icon={Users} />
        <StatCard testid="stat-clients-new" label="Novos (30 dias)" value={d.clients_new_30d} icon={UserPlus} />
        {d.mrr !== undefined && <StatCard testid="stat-mrr" accent label="Receita recorrente (MRR)" value={brl(d.mrr)} icon={Wallet} />}
        <StatCard testid="stat-requests-pending" label="Solicitações aguardando" value={d.requests_pending} icon={Inbox} />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-subs-active" label="Assinaturas ativas" value={s.ativa + s.teste} hint={`${s.teste} em teste`} />
        <StatCard testid="stat-subs-pending" label="Pendentes" value={s.pagamento_pendente} />
        <StatCard testid="stat-subs-overdue" label="Vencidas / inadimplentes" value={s.inadimplente} />
        <StatCard testid="stat-subs-cancelled" label="Canceladas" value={s.cancelada + s.cancelamento_solicitado} />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-ads-active" label="Anúncios no ar" value={d.ads.em_veiculacao} hint={`${d.ads.agendado} agendados`} icon={Megaphone} />
        <StatCard testid="stat-ads-pending" label="Anúncios pendentes" value={d.ads.aguardando_aprovacao + d.ads.rascunho} icon={Clock} />
        <StatCard testid="stat-ads-expired" label="Anúncios expirados" value={d.ads.expirado} icon={AlertTriangle} />
        <StatCard testid="stat-tracks" label="Músicas cadastradas" value={d.tracks_total} hint={`${d.tracks_active} ativas • playlist ${d.playlist ? fmtDur(d.playlist.total_duration) : "—"}`} icon={Library} />
      </div>
      {d.payments_month && (
        <div className="grid sm:grid-cols-3 gap-4">
          <StatCard testid="stat-payments-approved" label="Pagamentos aprovados (mês)" value={d.payments_month.aprovado} />
          <StatCard testid="stat-payments-refused" label="Pagamentos recusados (mês)" value={d.payments_month.recusado} />
          <StatCard testid="stat-payments-pending" label="Pagamentos pendentes (mês)" value={d.payments_month.pendente} />
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-6">
        <Panel title="Status dos serviços" testid="services-status-panel">
          <ul className="divide-y divide-border">{SERVICES.map(([k, l]) => <Service key={k} ok={d.services[k]} label={l} />)}</ul>
          <p className="text-xs text-slate-500 mt-3">Falhas de streaming nas últimas 24h: {d.stream_failures_24h}</p>
        </Panel>
        <Panel title="Anúncios vencendo em até 3 dias" action={<Link to="/admin/anuncios" className="text-xs text-primary">Ver todos</Link>}>
          {d.expiring_ads.length === 0 ? <p className="text-sm text-slate-500">Nenhum anúncio próximo do vencimento.</p> : (
            <ul className="divide-y divide-border" data-testid="expiring-ads-list">
              {d.expiring_ads.map((a) => <li key={a.id} className="py-2 text-sm flex justify-between gap-2"><span className="truncate">{a.title}<span className="block text-xs text-slate-500">{a.business_name}</span></span><span className="text-amber-300 shrink-0">{fmtDate(a.end_date)}</span></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Atividades recentes">
          <ul className="divide-y divide-border text-sm" data-testid="recent-activity-list">
            {d.recent_activity.map((l) => <li key={l.id} className="py-2"><p><span className="font-mono text-xs text-accent">{l.action}</span> <span className="text-slate-400">{l.entity}</span></p><p className="text-xs text-slate-500">{l.user_email} • {fmtDateTime(l.created_at)}</p></li>)}
          </ul>
        </Panel>
      </div>
      <p className="text-xs text-slate-500">Status: <StatusBadge status="ativa" /> = OK. Os indicadores são calculados em tempo real a partir do banco de dados.</p>
    </div>
  );
}
