import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Download, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, Loading, Field, NativeSelect } from "@/components/common";
import { api, errMsg, downloadFile } from "@/lib/api";
import { today } from "@/lib/today";

function Categories() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const load = useCallback(() => api.get("/categories").then((r) => setRows(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Panel title="Categorias de anúncios">
      <div className="flex gap-2 mb-4"><Input data-testid="category-name-input" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
        <Button data-testid="category-add-btn" disabled={name.length < 2} onClick={() => run(() => api.post("/admin/categories", { name, active: true }), "Categoria criada").then(() => setName(""))}><Plus className="w-4 h-4" /></Button></div>
      <ul className="divide-y divide-border max-h-96 overflow-y-auto" data-testid="categories-list">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <Input defaultValue={c.name} className="h-8" onBlur={(e) => e.target.value !== c.name && run(() => api.patch(`/admin/categories/${c.id}`, { name: e.target.value, active: c.active }), "Renomeada")} />
            <Switch data-testid={`category-active-${c.id}`} checked={c.active} onCheckedChange={(v) => run(() => api.patch(`/admin/categories/${c.id}`, { name: c.name, active: v }))} />
            <Button size="icon" variant="ghost" data-testid={`category-delete-${c.id}`} onClick={() => run(() => api.delete(`/admin/categories/${c.id}`), "Excluída")}><Trash2 className="w-4 h-4" /></Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const load = useCallback(() => api.get("/admin/settings").then((r) => setS(r.data)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!s) return <Loading />;
  const set = (k) => (e) => setS({ ...s, [k]: e?.target ? e.target.value : e });
  const save = async () => {
    try {
      const body = { ...s, grace_days: Number(s.grace_days), expiry_alert_days: Number(s.expiry_alert_days), tts_monthly_char_limit_per_client: Number(s.tts_monthly_char_limit_per_client), playlist_max_hours: Number(s.playlist_max_hours) };
      delete body.webhook_url;
      const { data } = await api.put("/admin/settings", body);
      setS({ ...data, webhook_url: s.webhook_url });
      toast.success("Configurações salvas com segurança no servidor");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const testMp = async () => {
    try {
      const { data } = await api.post("/admin/settings/test-mp");
      toast.success(`Conectado ao Mercado Pago: ${data.account} (${data.site})`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const maintenance = async () => {
    try {
      const { data } = await api.post("/admin/maintenance/run");
      toast.success(`Expirados: ${data.ads.expired} • Iniciados: ${data.ads.started} • Alertas: ${data.ads.alerts} • Inadimplentes: ${data.subscriptions.overdue}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const secret = (k, label, testid) => <Field label={label} hint={s[k] ? `Configurado (${s[k]}). Digite para substituir.` : "Não configurado"}><Input data-testid={testid} type="password" autoComplete="off" placeholder={s[k] || ""} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></Field>;
  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Credenciais ficam criptografadas no backend e nunca são enviadas ao navegador.">
        <Button data-testid="settings-save-btn" className="rounded-full" onClick={save}>Salvar configurações</Button>
      </PageHeader>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Mercado Pago" testid="settings-mercadopago">
          <div className="space-y-4">
            <Field label="Ambiente"><NativeSelect testid="settings-mp-mode" value={s.mp_mode} onChange={set("mp_mode")}><option value="teste">Teste (credenciais de teste)</option><option value="producao">Produção</option></NativeSelect></Field>
            {secret("mp_access_token", "Access Token", "settings-mp-access-token")}
            <Field label="Public Key"><Input data-testid="settings-mp-public-key" value={s.mp_public_key} onChange={set("mp_public_key")} /></Field>
            {secret("mp_webhook_secret", "Assinatura secreta do Webhook", "settings-mp-webhook-secret")}
            <Field label="URL do Webhook (cadastre no painel Mercado Pago: Suas integrações > Webhooks)" hint="Eventos: Planos e assinaturas (subscription_preapproval, subscription_authorized_payment) e Pagamentos."><Input readOnly value={s.webhook_url} data-testid="settings-webhook-url" onFocus={(e) => e.target.select()} /></Field>
            <Button variant="secondary" onClick={testMp} data-testid="settings-test-mp-btn">Testar conexão</Button>
          </div>
        </Panel>
        <Panel title="Voz e geração de áudio">
          <div className="space-y-4">
            {secret("elevenlabs_api_key", "Chave ElevenLabs (clonagem da voz oficial)", "settings-elevenlabs-key")}
            <Field label="Modelo de voz provisória (OpenAI)"><NativeSelect value={s.openai_tts_model} onChange={set("openai_tts_model")}><option value="tts-1">tts-1 (mais barato)</option><option value="tts-1-hd">tts-1-hd (melhor qualidade)</option></NativeSelect></Field>
            <Field label="Voz padrão"><Input value={s.default_voice} onChange={set("default_voice")} data-testid="settings-default-voice" /></Field>
            <Field label="Limite mensal de caracteres por cliente (controle de custo)"><Input type="number" value={s.tts_monthly_char_limit_per_client} onChange={set("tts_monthly_char_limit_per_client")} /></Field>
          </div>
        </Panel>
        <Panel title="Inadimplência e validade">
          <div className="space-y-4">
            <Field label="Período de tolerância (dias)"><Input data-testid="settings-grace-days" type="number" value={s.grace_days} onChange={set("grace_days")} /></Field>
            <label className="flex items-center gap-3 text-sm"><Switch data-testid="settings-suspend-switch" checked={!!s.suspend_radio_when_overdue} onCheckedChange={set("suspend_radio_when_overdue")} />Suspender a rádio após a tolerância (os dados nunca são excluídos)</label>
            <Field label="Avisar vencimento de anúncios com antecedência (dias)"><Input type="number" value={s.expiry_alert_days} onChange={set("expiry_alert_days")} /></Field>
            <Field label="Duração máxima da playlist (horas)"><Input type="number" value={s.playlist_max_hours} onChange={set("playlist_max_hours")} /></Field>
          </div>
        </Panel>
        <Panel title="Geral">
          <div className="space-y-4">
            <Field label="E-mail de suporte"><Input value={s.support_email} onChange={set("support_email")} /></Field>
            <Field label="Telefone de suporte"><Input value={s.support_phone} onChange={set("support_phone")} /></Field>
            <p className="text-xs text-slate-500">E-mail automático: não configurado — notificações apenas internas.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" data-testid="settings-backup-btn" onClick={() => downloadFile("/admin/backup", `backup-markimagem-${today()}.json`)}><Download className="w-4 h-4 mr-1" />Baixar backup</Button>
              <Button variant="secondary" data-testid="settings-maintenance-btn" onClick={maintenance}><PlayCircle className="w-4 h-4 mr-1" />Executar rotina de validade agora</Button>
            </div>
          </div>
        </Panel>
        <Categories />
      </div>
    </div>
  );
}
