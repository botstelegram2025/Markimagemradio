import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel, Loading, Field, NativeSelect } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const PRESETS = [["1", "Após cada música"], ["2", "A cada 2 músicas"], ["3", "A cada 3 músicas"], ["4", "A cada 4 músicas"], ["5", "A cada 5 músicas"], ["time", "Por tempo decorrido"], ["custom", "Programação personalizada"]];
const NUM = [["ads_per_break", "Anúncios por intervalo"], ["max_break_seconds", "Duração máxima do intervalo (s)"], ["max_ad_seconds_per_hour", "Publicidade máxima por hora (s)"], ["max_repeats_per_hour", "Limite de repetição do mesmo anúncio por hora"], ["peak_ads_per_break", "Anúncios por intervalo no horário de pico"]];
const hoursToStr = (a) => (a || []).join(", ");
const strToHours = (s) => s.split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n < 24);

export default function Breaks() {
  const [r, setR] = useState(null);
  const [biz, setBiz] = useState("");
  const [clients, setClients] = useState([]);
  const [cats, setCats] = useState([]);
  const { user } = useAuth();
  const canEdit = user.role === "superadmin";
  useEffect(() => {
    api.get("/admin/clients").then((x) => setClients(x.data));
    api.get("/categories").then((x) => setCats(x.data));
  }, []);
  useEffect(() => {
    setR(null);
    api.get("/admin/programming/rules", { params: { business_id: biz } }).then((x) => setR(x.data));
  }, [biz]);
  if (!r) return <Loading />;
  const preset = r.mode === "every_n" ? String(r.every_n) : r.mode;
  const setPreset = (v) => (["time", "custom"].includes(v) ? setR({ ...r, mode: v }) : setR({ ...r, mode: "every_n", every_n: Number(v) }));
  const save = async () => {
    try {
      const body = { ...r };
      NUM.concat([["every_n"], ["every_minutes"]]).forEach(([k]) => { body[k] = Number(body[k] || 0); });
      if (body.mode === "custom") body.mode = "every_n";
      await api.put("/admin/programming/rules", body, { params: { business_id: biz } });
      toast.success("Regras salvas. Valem a partir do próximo item da programação.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const camp = r.campaign || {};
  return (
    <div className="space-y-6">
      <PageHeader title="Programação de Intervalos" subtitle="Defina quando e quantos anúncios entram entre as músicas. Sem anúncios válidos, a rádio segue só com música.">
        {canEdit && <Button data-testid="breaks-save-btn" className="rounded-full" onClick={save}>Salvar regras</Button>}
      </PageHeader>
      <Panel>
        <Field label="Escopo das regras" hint="Regras específicas por cliente dependem do plano (intervalos personalizados).">
          <NativeSelect testid="breaks-scope-select" value={biz} onChange={setBiz}><option value="">Global (todas as rádios)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        </Field>
        {biz && <label className="flex items-center gap-3 text-sm mt-4"><Switch data-testid="breaks-override-switch" checked={!!r.enabled} onCheckedChange={(v) => setR({ ...r, enabled: v })} />Usar regras próprias para este cliente</label>}
      </Panel>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Frequência">
          <div className="space-y-4">
            <Field label="Intervalo entre anúncios"><NativeSelect testid="breaks-preset-select" value={preset} onChange={setPreset}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></Field>
            {r.mode === "time" && <Field label="Minutos entre intervalos"><Input data-testid="breaks-minutes-input" type="number" min={1} value={r.every_minutes} onChange={(e) => setR({ ...r, every_minutes: e.target.value })} /></Field>}
            {r.mode === "custom" && <Field label="A cada N músicas"><Input type="number" min={1} value={r.every_n} onChange={(e) => setR({ ...r, every_n: e.target.value })} /></Field>}
            {NUM.map(([k, l]) => <Field key={k} label={l}><Input data-testid={`breaks-${k}-input`} type="number" min={0} value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} /></Field>)}
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Ordem e prioridades">
            <div className="space-y-4">
              <Field label="Ordem de reprodução"><NativeSelect testid="breaks-order-select" value={r.order} onChange={(v) => setR({ ...r, order: v })}><option value="priority">Por prioridade</option><option value="rotation">Rodízio (menos tocado primeiro)</option><option value="random">Aleatória</option></NativeSelect></Field>
              <Field label="Categorias prioritárias">
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">{cats.map((c) => {
                  const on = (r.priority_categories || []).includes(c.id);
                  return <button type="button" key={c.id} onClick={() => setR({ ...r, priority_categories: on ? r.priority_categories.filter((x) => x !== c.id) : [...(r.priority_categories || []), c.id] })} className={`px-2.5 py-1 rounded-full text-xs border ${on ? "bg-primary border-primary text-white" : "border-border text-slate-400"}`}>{c.name}</button>;
                })}</div>
              </Field>
            </div>
          </Panel>
          <Panel title="Intensidade e pausas">
            <div className="space-y-4">
              <label className="flex items-center gap-3 text-sm"><Switch data-testid="breaks-paused-switch" checked={!!r.ads_paused} onCheckedChange={(v) => setR({ ...r, ads_paused: v })} />Pausar temporariamente todos os anúncios</label>
              <Field label="Horários de pico (mais anúncios)" hint="Horas separadas por vírgula, ex.: 11, 12, 17, 18"><Input data-testid="breaks-peak-hours-input" defaultValue={hoursToStr(r.peak_hours)} onBlur={(e) => setR({ ...r, peak_hours: strToHours(e.target.value) })} /></Field>
              <Field label="Horários sem anúncios (menor intensidade)" hint="Ex.: 7, 22"><Input data-testid="breaks-low-hours-input" defaultValue={hoursToStr(r.low_hours)} onBlur={(e) => setR({ ...r, low_hours: strToHours(e.target.value) })} /></Field>
            </div>
          </Panel>
          <Panel title="Intervalo especial de campanha">
            <div className="space-y-4">
              <label className="flex items-center gap-3 text-sm"><Switch data-testid="breaks-campaign-switch" checked={!!camp.enabled} onCheckedChange={(v) => setR({ ...r, campaign: { ...camp, enabled: v } })} />Ativar campanha</label>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Início"><Input type="date" value={camp.start_date || ""} onChange={(e) => setR({ ...r, campaign: { ...camp, start_date: e.target.value } })} /></Field>
                <Field label="Fim"><Input type="date" value={camp.end_date || ""} onChange={(e) => setR({ ...r, campaign: { ...camp, end_date: e.target.value } })} /></Field>
                <Field label="A cada N músicas"><Input type="number" min={1} value={camp.every_n || 1} onChange={(e) => setR({ ...r, campaign: { ...camp, every_n: Number(e.target.value) } })} /></Field>
              </div>
            </div>
          </Panel>
        </div>
      </div>
      {!canEdit && <p className="text-sm text-slate-500">Somente o superadministrador pode alterar estas regras.</p>}
    </div>
  );
}
