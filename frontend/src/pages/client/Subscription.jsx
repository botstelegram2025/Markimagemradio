import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, StatusBadge, Loading, Field } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { brl, fmtDate, fmtDateTime } from "@/lib/format";

export default function ClientSubscription() {
  const [d, setD] = useState(null);
  const [plans, setPlans] = useState([]);
  const [payer, setPayer] = useState("");
  const [busy, setBusy] = useState("");
  const [params] = useSearchParams();

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api.get("/client/subscription"), api.get("/plans")]);
    setD(s.data);
    setPlans(p.data);
  }, []);

  useEffect(() => {
    (async () => {
      if (params.get("retorno")) {
        try {
          await api.post("/client/subscription/sync");
          toast.info("Status verificado diretamente no Mercado Pago.");
        } catch (e) {
          toast.error(errMsg(e));
        }
      }
      load();
    })();
  }, [params, load]);

  const contract = async (plan) => {
    setBusy(plan.id);
    try {
      const { data } = await api.post("/client/subscription/checkout", { plan_id: plan.id, payer_email: payer || null });
      if (data.trial) {
        toast.success("Período de teste iniciado! Sua rádio já está liberada.");
        load();
      } else window.location.assign(data.checkout_url);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };
  const sync = async () => {
    try {
      await api.post("/client/subscription/sync");
      toast.success("Status atualizado");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const cancel = async () => {
    try {
      await api.post("/client/subscription/cancel");
      toast.success("Cancelamento registrado");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!d) return <Loading />;
  const sub = d.subscription;
  const canCancel = sub && ["ativa", "teste", "pagamento_pendente", "inadimplente"].includes(sub.status);
  return (
    <div className="space-y-8">
      <PageHeader title="Minha assinatura" subtitle="Pagamento mensal recorrente via Mercado Pago. A liberação ocorre somente após a confirmação do pagamento no servidor." />
      <Panel title="Assinatura atual" testid="client-current-subscription">
        {!sub ? <p className="text-slate-400 text-sm">Você ainda não contratou um plano.</p> : (
          <div className="grid sm:grid-cols-4 gap-6 text-sm">
            <div><p className="text-slate-500 text-xs uppercase">Plano</p><p className="font-semibold text-lg">{sub.plan_name}</p></div>
            <div><p className="text-slate-500 text-xs uppercase">Status</p><StatusBadge testid="client-subscription-status" status={sub.status} /></div>
            <div><p className="text-slate-500 text-xs uppercase">Valor</p><p className="font-semibold">{brl(sub.amount)}</p></div>
            <div><p className="text-slate-500 text-xs uppercase">{sub.status === "teste" ? "Teste até" : "Período até"}</p><p className="font-semibold">{fmtDate(sub.trial_end || sub.current_period_end)}</p></div>
          </div>
        )}
        {sub && (
          <div className="flex flex-wrap gap-2 mt-6">
            {sub.mp_preapproval_id && <Button data-testid="client-subscription-sync-btn" variant="secondary" size="sm" onClick={sync}>Verificar pagamento</Button>}
            {sub.status === "pagamento_pendente" && sub.init_point && <a href={sub.init_point}><Button data-testid="client-subscription-pay-btn" size="sm">Concluir pagamento</Button></a>}
            {canCancel && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button data-testid="client-subscription-cancel-btn" variant="ghost" size="sm" className="text-red-400">Cancelar assinatura</Button></AlertDialogTrigger>
                <AlertDialogContent className="bg-card">
                  <AlertDialogHeader><AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle>
                    <AlertDialogDescription>A cobrança recorrente será interrompida no Mercado Pago. Você mantém o acesso até o fim do período pago. Seus dados não serão excluídos.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Voltar</AlertDialogCancel><AlertDialogAction data-testid="client-subscription-cancel-confirm" onClick={cancel}>Confirmar cancelamento</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
        {sub?.history?.length > 0 && (
          <ul className="mt-6 text-xs text-slate-400 space-y-1">{sub.history.slice(-5).reverse().map((h, i) => <li key={i}>{fmtDateTime(h.at)} — {h.note}</li>)}</ul>
        )}
      </Panel>

      <Panel title="Contratar ou trocar de plano">
        <div className="max-w-sm mb-6"><Field label="E-mail do pagador no Mercado Pago (opcional)" hint="Use se pagar com outra conta Mercado Pago."><Input data-testid="checkout-payer-email-input" type="email" value={payer} onChange={(e) => setPayer(e.target.value)} /></Field></div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.length === 0 && <p className="text-sm text-slate-500">Nenhum plano publicado no momento.</p>}
          {plans.map((p, i) => (
            <div key={p.id} className="rounded-2xl border border-border p-5 flex flex-col" data-testid={`client-plan-card-${i}`}>
              <p className="font-semibold text-lg">{p.name}</p>
              <p className="text-xs text-slate-400 mt-1 flex-1">{p.description}</p>
              <p className="text-2xl font-bold mt-4">{(p.promo_price || p.price) > 0 ? brl(p.promo_price || p.price) : "Sob consulta"}<span className="text-xs text-slate-400"> /mês</span></p>
              <Button data-testid={`checkout-mercado-pago-btn-${i}`} className="mt-4 rounded-full" disabled={busy === p.id || sub?.plan_id === p.id && sub?.status === "ativa"} onClick={() => contract(p)}>
                {busy === p.id ? "Redirecionando…" : p.trial_days > 0 ? `Testar ${p.trial_days} dias` : "Assinar com Mercado Pago"}
              </Button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
