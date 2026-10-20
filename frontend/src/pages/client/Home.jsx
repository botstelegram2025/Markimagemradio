import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Megaphone, CreditCard, Inbox } from "lucide-react";
import RadioPlayer from "@/components/RadioPlayer";
import { PageHeader, Panel, StatusBadge, StatCard, Empty, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";

export default function ClientHome() {
  const [d, setD] = useState(null);
  useEffect(() => {
    api.get("/client/overview").then((r) => setD(r.data));
  }, []);
  if (!d) return <Loading />;
  const next = d.active_ads.find((a) => a.end_date);
  return (
    <div className="space-y-8">
      <PageHeader title={`Olá, ${d.business.name}`} subtitle="Sua rádio, seus anúncios e sua assinatura em um só lugar." />
      {!d.radio_allowed && (
        <div data-testid="client-radio-blocked-alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-amber-200 text-sm"><strong>Rádio indisponível:</strong> {d.reason}.</p>
          <Link to="/cliente/assinatura"><Button data-testid="client-go-subscription-btn" className="rounded-full">Ver assinatura</Button></Link>
        </div>
      )}
      <RadioPlayer stationName={`Rádio ${d.business.name}`} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="client-stat-subscription" label="Assinatura" icon={CreditCard} value={<StatusBadge status={d.subscription?.status || "inativo"} />} hint={d.subscription?.plan_name || "Nenhum plano"} />
        <StatCard testid="client-stat-active-ads" label="Anúncios ativos" icon={Megaphone} value={d.active_ads.length} />
        <StatCard testid="client-stat-next-expiry" label="Próxima validade" icon={CalendarClock} value={next ? fmtDate(next.end_date) : "—"} hint={next?.title} />
        <StatCard testid="client-stat-pending-requests" label="Solicitações em andamento" icon={Inbox} value={d.pending_requests} />
      </div>
      <Panel title="Anúncios no ar e programados" action={<Link to="/cliente/anuncios"><Button size="sm" variant="secondary" data-testid="client-request-ad-btn">Solicitar anúncio</Button></Link>}>
        {d.active_ads.length === 0 ? <Empty>Você ainda não tem anúncios ativos.</Empty> : (
          <ul className="divide-y divide-border" data-testid="client-active-ads-list">
            {d.active_ads.map((a) => (
              <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-semibold">{a.title}</p><p className="text-xs text-slate-400">De {fmtDate(a.start_date)} até {fmtDate(a.end_date)}</p></div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
