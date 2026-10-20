import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Field, Empty, NativeSelect } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { brl, fmtDate, LABELS } from "@/lib/format";

const BLANK = { name: "", description: "", price: 0, promo_price: null, billing_period_months: 1, max_active_ads: 3, max_requests_month: 2, max_categories: 0, features: [], storage_mb: 200, can_request_updates: true, support_type: "", trial_days: 0, published: false, requires_approval: true, allow_attachments: true, client_preview_approval: false, custom_breaks: false, order: 0 };
const NUMS = [["price", "Preço mensal (R$)"], ["promo_price", "Preço promocional (R$)"], ["billing_period_months", "Período de cobrança (meses)"], ["max_active_ads", "Limite de anúncios ativos (0 = livre)"], ["max_requests_month", "Solicitações por mês (0 = livre)"], ["max_categories", "Categorias permitidas (0 = todas)"], ["storage_mb", "Armazenamento (MB)"], ["trial_days", "Dias de teste"], ["order", "Ordem de exibição"]];
const BOOLS = [["published", "Publicado na página pública"], ["requires_approval", "Aprovação obrigatória do administrador"], ["can_request_updates", "Pode solicitar atualizações"], ["allow_attachments", "Pode enviar anexos"], ["client_preview_approval", "Cliente aprova a prévia antes de veicular"], ["custom_breaks", "Intervalos personalizados"]];

function PlanDialog({ plan, onClose, onDone }) {
  const [f, setF] = useState(BLANK);
  useEffect(() => {
    if (plan) setF({ ...BLANK, ...plan });
  }, [plan]);
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, promo_price: f.promo_price === "" || f.promo_price == null ? null : Number(f.promo_price) };
    NUMS.forEach(([k]) => { if (k !== "promo_price") body[k] = Number(body[k] || 0); });
    try {
      if (plan.id) await api.put(`/admin/plans/${plan.id}`, body);
      else await api.post("/admin/plans", body);
      toast.success("Plano salvo");
      onDone();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <Dialog open={!!plan} onOpenChange={onClose}>
      <DialogContent className="bg-card max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="plan-dialog">
        <DialogHeader><DialogTitle>{plan?.id ? "Editar plano" : "Novo plano"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3"><Field label="Nome"><Input data-testid="plan-name-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><Field label="Descrição"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
          {NUMS.map(([k, l]) => <Field key={k} label={l}><Input data-testid={`plan-${k}-input`} type="number" step="0.01" min="0" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          <div className="sm:col-span-3"><Field label="Tipo de atendimento"><Input value={f.support_type} onChange={(e) => setF({ ...f, support_type: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><Field label="Recursos (um por linha)"><Textarea rows={3} value={(f.features || []).join("\n")} onChange={(e) => setF({ ...f, features: e.target.value.split("\n").filter(Boolean) })} /></Field></div>
          {BOOLS.map(([k, l]) => <label key={k} className="flex items-center gap-3 text-sm"><Switch data-testid={`plan-${k}-switch`} checked={!!f[k]} onCheckedChange={(v) => setF({ ...f, [k]: v })} />{l}</label>)}
          <div className="sm:col-span-3"><Button data-testid="plan-save-btn" className="rounded-full">Salvar plano</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Subscriptions() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("");
  const [clients, setClients] = useState({});
  const load = useCallback(() => api.get("/admin/subscriptions", { params: { status } }).then((r) => setRows(r.data)), [status]);
  useEffect(() => {
    load();
    api.get("/admin/clients").then((r) => setClients(Object.fromEntries(r.data.map((b) => [b.id, b.name]))));
  }, [load]);
  const change = async (s, st) => {
    try {
      await api.patch(`/admin/subscriptions/${s.id}`, { status: st });
      toast.success("Status alterado");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const sync = async (s) => {
    try {
      await api.post(`/admin/subscriptions/${s.id}/sync`);
      toast.success("Sincronizado com Mercado Pago");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Panel>
      <div className="max-w-xs mb-4"><NativeSelect testid="subs-status-filter" value={status} onChange={setStatus}><option value="">Todos os status</option>{["teste", "ativa", "pagamento_pendente", "inadimplente", "cancelamento_solicitado", "cancelada", "encerrada"].map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect></div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhuma assinatura.</Empty> : (
        <Table cols={["Cliente", "Plano", "Valor", "Status", "Período até", "Ações"]} testid="subscriptions-table">
          {rows.map((s) => (
            <tr key={s.id}>
              <Td className="font-semibold">{clients[s.business_id] || "—"}</Td><Td>{s.plan_name}</Td><Td>{brl(s.amount)}</Td><Td><StatusBadge status={s.status} /></Td>
              <Td>{fmtDate(s.current_period_end || s.trial_end)}</Td>
              <Td className="flex gap-2">
                <NativeSelect className="h-8 w-44" testid={`sub-status-select-${s.id}`} value={s.status} onChange={(v) => change(s, v)}>{["teste", "ativa", "pagamento_pendente", "inadimplente", "cancelamento_solicitado", "cancelada", "encerrada"].map((x) => <option key={x} value={x}>{LABELS[x]}</option>)}</NativeSelect>
                {s.mp_preapproval_id && <Button size="sm" variant="secondary" onClick={() => sync(s)} data-testid={`sub-sync-btn-${s.id}`}>Sincronizar</Button>}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

export default function Plans() {
  const [plans, setPlans] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.get("/admin/plans").then((r) => setPlans(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  const archive = async (p) => {
    if (!window.confirm(`Arquivar ${p.name}? Assinaturas existentes são preservadas.`)) return;
    await api.delete(`/admin/plans/${p.id}`);
    load();
  };
  return (
    <div>
      <PageHeader title="Planos e assinaturas" subtitle="Os preços dos planos iniciais estão zerados e não publicados: defina valores antes de publicar.">
        <Button data-testid="new-plan-btn" className="rounded-full" onClick={() => setEdit({})}><Plus className="w-4 h-4 mr-1" />Novo plano</Button>
      </PageHeader>
      <Tabs defaultValue="plans">
        <TabsList className="mb-6"><TabsTrigger value="plans" data-testid="tab-plans">Planos</TabsTrigger><TabsTrigger value="subs" data-testid="tab-subscriptions">Assinaturas</TabsTrigger></TabsList>
        <TabsContent value="plans">
          {!plans ? <Loading /> : (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="admin-plans-list">
              {plans.map((p) => (
                <div key={p.id} className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-2" data-testid={`admin-plan-${p.id}`}>
                  <div className="flex justify-between gap-2"><p className="font-semibold">{p.name}</p><StatusBadge status={p.published ? "ativo" : "rascunho"} /></div>
                  <p className="text-2xl font-bold">{brl(p.promo_price || p.price)}</p>
                  <p className="text-xs text-slate-400">{p.max_active_ads || "∞"} anúncios • {p.max_requests_month || "∞"} solicitações/mês • {p.trial_days} dias teste</p>
                  <p className="text-xs text-slate-500">{p.requires_approval ? "Aprovação obrigatória" : "Publicação automática"}</p>
                  <div className="flex gap-2 mt-auto pt-3">
                    <Button size="sm" variant="secondary" onClick={() => setEdit(p)} data-testid={`edit-plan-btn-${p.id}`}><Pencil className="w-3.5 h-3.5 mr-1" />Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => archive(p)} data-testid={`archive-plan-btn-${p.id}`}><Archive className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="subs"><Subscriptions /></TabsContent>
      </Tabs>
      <PlanDialog plan={edit} onClose={() => setEdit(null)} onDone={load} />
    </div>
  );
}
