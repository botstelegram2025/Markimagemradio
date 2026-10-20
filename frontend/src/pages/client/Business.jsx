import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, Field, Loading } from "@/components/common";
import { api, errMsg, fileUrl, downloadFile } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

function PasswordForm() {
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/change-password", f);
      toast.success("Senha alterada");
      setF({ current_password: "", new_password: "" });
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Senha atual"><Input data-testid="change-password-current" type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
      <Field label="Nova senha"><Input data-testid="change-password-new" type="password" minLength={8} required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
      <Button data-testid="change-password-submit" variant="secondary">Alterar senha</Button>
    </form>
  );
}

export default function ClientBusiness() {
  const [b, setB] = useState(null);
  const { reload } = useAuth();
  useEffect(() => {
    api.get("/client/business").then((r) => setB(r.data));
  }, []);
  if (!b) return <Loading />;
  const set = (k) => (e) => setB({ ...b, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      const { name, phone, segment, address, city, state, cnpj } = b;
      await api.put("/client/business", { name, phone, segment, address, city, state: (state || "").toUpperCase().slice(0, 2), cnpj });
      toast.success("Dados salvos");
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/client/business/logo", fd);
      setB({ ...b, logo_file_id: data.logo_file_id });
      toast.success("Logotipo atualizado");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader title="Meu estabelecimento" subtitle="Dados cadastrais usados nos seus anúncios e na cobrança." />
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        <Panel title="Dados do estabelecimento">
          <form onSubmit={save} className="grid sm:grid-cols-2 gap-4" data-testid="business-form">
            <Field label="Nome da loja"><Input data-testid="business-name-input" required value={b.name} onChange={set("name")} /></Field>
            <Field label="Segmento"><Input data-testid="business-segment-input" value={b.segment || ""} onChange={set("segment")} /></Field>
            <Field label="Telefone"><Input data-testid="business-phone-input" value={b.phone || ""} onChange={set("phone")} /></Field>
            <Field label="CNPJ"><Input data-testid="business-cnpj-input" value={b.cnpj || ""} onChange={set("cnpj")} /></Field>
            <div className="sm:col-span-2"><Field label="Endereço"><Input data-testid="business-address-input" value={b.address || ""} onChange={set("address")} /></Field></div>
            <Field label="Cidade"><Input data-testid="business-city-input" value={b.city || ""} onChange={set("city")} /></Field>
            <Field label="UF"><Input data-testid="business-state-input" maxLength={2} value={b.state || ""} onChange={set("state")} /></Field>
            <div className="sm:col-span-2"><Button data-testid="business-save-btn" className="rounded-full">Salvar dados</Button></div>
          </form>
        </Panel>
        <div className="space-y-6">
          <Panel title="Logotipo">
            <div className="w-32 h-32 rounded-2xl bg-secondary border border-border overflow-hidden flex items-center justify-center mb-4">
              {b.logo_file_id ? <img src={fileUrl(b.logo_file_id)} alt="Logotipo" className="w-full h-full object-contain" /> : <span className="text-xs text-slate-500">Sem logo</span>}
            </div>
            <Input data-testid="business-logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} />
          </Panel>
          <Panel title="Segurança"><PasswordForm /></Panel>
          <Panel title="Meus dados (LGPD)">
            <p className="text-sm text-slate-400 mb-3">Baixe uma cópia dos seus dados cadastrais, anúncios, solicitações e pagamentos.</p>
            <Button data-testid="export-data-btn" variant="secondary" onClick={() => downloadFile("/client/export", "meus-dados.json")}>Exportar meus dados</Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
