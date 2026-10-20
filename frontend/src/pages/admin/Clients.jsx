import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Field, Empty, NativeSelect } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { brl, fmtDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";

function NewClient({ open, onClose, onDone }) {
  const [f, setF] = useState({ name: "", email: "", password: "", business_name: "", phone: "", segment: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/admin/clients", f);
      toast.success("Cliente criado");
      onDone();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card"><DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4" data-testid="new-client-form">
          <Field label="Estabelecimento"><Input data-testid="new-client-business" required value={f.business_name} onChange={set("business_name")} /></Field>
          <Field label="Segmento"><Input value={f.segment} onChange={set("segment")} /></Field>
          <Field label="Responsável"><Input data-testid="new-client-name" required value={f.name} onChange={set("name")} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="E-mail"><Input data-testid="new-client-email" type="email" required value={f.email} onChange={set("email")} /></Field>
          <Field label="Senha inicial"><Input data-testid="new-client-password" type="password" minLength={8} required value={f.password} onChange={set("password")} /></Field>
          <Button data-testid="new-client-submit" className="sm:col-span-2">Criar cliente</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClientDetail({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState("");
  const { user } = useAuth();
  const isSuper = user.role === "superadmin";
  const load = useCallback(() => api.get(`/admin/clients/${id}`).then((r) => setD(r.data)), [id]);
  useEffect(() => {
    if (!id) return;
    setD(null);
    load();
    if (isSuper) api.get("/admin/plans").then((r) => setPlans(r.data));
  }, [id, load, isSuper]);
  const setStatus = async (status) => {
    try {
      await api.patch(`/admin/clients/${id}`, { status });
      toast.success("Status atualizado");
      load();
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const grant = async () => {
    try {
      await api.post("/admin/subscriptions", { business_id: id, plan_id: planId, status: "ativa", months: 1 });
      toast.success("Assinatura liberada");
      load();
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Sheet open={!!id} onOpenChange={onClose}>
      <SheetContent className="bg-card w-full sm:max-w-xl overflow-y-auto" data-testid="client-detail-sheet">
        {!d ? <Loading /> : <>
          <SheetHeader><SheetTitle>{d.business.name}</SheetTitle></SheetHeader>
          <div className="space-y-6 mt-6 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <p><span className="text-slate-500 block text-xs">Segmento</span>{d.business.segment || "—"}</p>
              <p><span className="text-slate-500 block text-xs">Telefone</span>{d.business.phone || "—"}</p>
              <p><span className="text-slate-500 block text-xs">Endereço</span>{d.business.address || "—"} {d.business.city}</p>
              <p><span className="text-slate-500 block text-xs">Rádio</span>{d.radio_access.allowed ? "Liberada" : d.radio_access.reason}</p>
            </div>
            {isSuper && <div className="flex gap-2 items-center"><span className="text-slate-500 text-xs">Conta:</span><StatusBadge status={d.business.status} />
              {d.business.status === "ativo" ? <Button size="sm" variant="ghost" className="text-red-400" data-testid="client-suspend-btn" onClick={() => setStatus("suspenso")}>Suspender</Button> : <Button size="sm" variant="secondary" data-testid="client-activate-btn" onClick={() => setStatus("ativo")}>Reativar</Button>}</div>}
            <div><p className="font-semibold mb-2">Usuários</p>{d.users.map((u) => <p key={u.id} className="text-slate-300">{u.name} — {u.email}</p>)}</div>
            {isSuper && <div>
              <p className="font-semibold mb-2">Assinaturas</p>
              {(d.subscriptions || []).map((s) => <div key={s.id} className="flex justify-between py-1"><span>{s.plan_name} • {brl(s.amount)}</span><StatusBadge status={s.status} /></div>)}
              <div className="flex gap-2 mt-3"><NativeSelect testid="client-grant-plan-select" value={planId} onChange={setPlanId}><option value="">Liberar plano manualmente…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
                <Button size="sm" disabled={!planId} onClick={grant} data-testid="client-grant-plan-btn">Liberar</Button></div>
            </div>}
            <div><p className="font-semibold mb-2">Anúncios ({d.ads.length})</p>{d.ads.slice(0, 15).map((a) => <div key={a.id} className="flex justify-between py-1 gap-2"><span className="truncate">{a.title} <span className="text-xs text-slate-500">até {fmtDate(a.end_date)}</span></span><StatusBadge status={a.status} /></div>)}</div>
            {isSuper && <div><p className="font-semibold mb-2">Pagamentos</p>{(d.payments || []).length === 0 ? <p className="text-slate-500">Nenhum</p> : d.payments.map((p) => <div key={p.id} className="flex justify-between py-1"><span>{fmtDate(p.created_at)} • {brl(p.amount)}</span><StatusBadge status={p.status} /></div>)}</div>}
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}

export default function Clients() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const { user } = useAuth();
  const load = useCallback(() => api.get("/admin/clients", { params: { q } }).then((r) => setRows(r.data)), [q]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div>
      <PageHeader title="Clientes" subtitle="Estabelecimentos cadastrados, assinaturas e anúncios.">
        {user.role === "superadmin" && <Button data-testid="new-client-btn" className="rounded-full" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 mr-1" />Novo cliente</Button>}
      </PageHeader>
      <Panel>
        <div className="relative max-w-sm mb-4"><Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" /><Input data-testid="clients-search-input" className="pl-9" placeholder="Buscar estabelecimento" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhum cliente encontrado.</Empty> : (
          <Table cols={["Estabelecimento", "Responsável", "Plano", "Assinatura", "Anúncios ativos", "Conta", "Cadastro"]} testid="clients-table">
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/40 cursor-pointer" onClick={() => setSel(b.id)} data-testid={`client-row-${b.id}`}>
                <Td className="font-semibold">{b.name}<span className="block text-xs text-slate-500 font-normal">{b.segment}</span></Td>
                <Td className="text-slate-400">{b.owner?.email}</Td><Td>{b.subscription?.plan_name || "—"}</Td>
                <Td><StatusBadge status={b.subscription?.status || "inativo"} /></Td><Td>{b.active_ads}</Td>
                <Td><StatusBadge status={b.status} /></Td><Td>{fmtDate(b.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <ClientDetail id={sel} onClose={() => setSel(null)} onChanged={load} />
      <NewClient open={newOpen} onClose={() => setNewOpen(false)} onDone={load} />
    </div>
  );
}
