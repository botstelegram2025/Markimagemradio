import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, Table, Td, Loading, Field, NativeSelect } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime, LABELS } from "@/lib/format";

const PERMS = [["superadmin", "Controle total: clientes, planos, financeiro, configurações, usuários e logs."], ["operador", "Cadastra, revisa, aprova e organiza anúncios, músicas, voz e solicitações. Sem acesso financeiro ou a configurações críticas."], ["cliente", "Acesso apenas aos dados do próprio estabelecimento."]];

export default function UsersPage() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "operador" });
  const load = useCallback(() => api.get("/admin/users").then((r) => setRows(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/admin/users", f);
      toast.success("Usuário criado");
      setOpen(false);
      setF({ name: "", email: "", password: "", role: "operador" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const patch = async (u, body) => {
    try {
      await api.patch(`/admin/users/${u.id}`, body);
      toast.success("Usuário atualizado");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const resetPwd = (u) => {
    const p = window.prompt(`Nova senha para ${u.email} (mín. 8 caracteres):`);
    if (p) patch(u, { password: p });
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Usuários e permissões" subtitle="Gerencie a equipe MarkImagem e o acesso dos clientes.">
        <Button data-testid="new-user-btn" className="rounded-full" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />Novo usuário</Button>
      </PageHeader>
      <div className="grid md:grid-cols-3 gap-4">{PERMS.map(([r, d]) => <Panel key={r} title={LABELS[r]}><p className="text-sm text-slate-400">{d}</p></Panel>)}</div>
      <Panel>
        {!rows ? <Loading /> : (
          <Table cols={["Nome", "E-mail", "Perfil", "Último acesso", "Ativo", "Ações"]} testid="users-table">
            {rows.map((u) => (
              <tr key={u.id} data-testid={`user-row-${u.id}`}>
                <Td className="font-semibold">{u.name}</Td><Td className="text-slate-400">{u.email}</Td>
                <Td>{u.role === "cliente" ? LABELS.cliente : <NativeSelect className="h-8 w-48" testid={`user-role-select-${u.id}`} value={u.role} onChange={(v) => patch(u, { role: v })}><option value="superadmin">Superadministrador</option><option value="operador">Operador de conteúdo</option></NativeSelect>}</Td>
                <Td className="text-xs">{fmtDateTime(u.last_login_at)}</Td>
                <Td><Switch data-testid={`user-active-switch-${u.id}`} checked={u.active !== false} onCheckedChange={(v) => patch(u, { active: v })} /></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => resetPwd(u)} data-testid={`user-reset-password-${u.id}`}>Redefinir senha</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card"><DialogHeader><DialogTitle>Novo usuário da equipe</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-4" data-testid="new-user-form">
            <Field label="Nome"><Input data-testid="new-user-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="E-mail"><Input data-testid="new-user-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Senha inicial"><Input data-testid="new-user-password" type="password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Perfil"><NativeSelect testid="new-user-role" value={f.role} onChange={(v) => setF({ ...f, role: v })}><option value="operador">Operador de conteúdo</option><option value="superadmin">Superadministrador</option></NativeSelect></Field>
            <Button data-testid="new-user-submit">Criar usuário</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
