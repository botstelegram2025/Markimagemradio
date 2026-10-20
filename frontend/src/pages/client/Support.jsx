import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, Field, StatusBadge, Empty } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

export default function ClientSupport() {
  const [f, setF] = useState({ title: "", text: "" });
  const [items, setItems] = useState([]);
  const load = useCallback(() => api.get("/client/requests").then((r) => setItems(r.data.filter((x) => x.type === "suporte"))), []);
  useEffect(() => {
    load();
  }, [load]);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/client/requests", { type: "suporte", title: f.title, text: f.text });
      toast.success("Mensagem enviada ao suporte");
      setF({ title: "", text: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader title="Suporte" subtitle="Fale com a equipe MarkImagem." />
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <Panel title="Abrir chamado">
          <form onSubmit={submit} className="space-y-4" data-testid="support-form">
            <Field label="Assunto"><Input data-testid="support-title-input" required minLength={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Mensagem"><Textarea data-testid="support-text-input" rows={5} required value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
            <Button data-testid="support-submit-btn" className="rounded-full">Enviar</Button>
          </form>
        </Panel>
        <Panel title="Contato">
          <p className="flex items-center gap-2 text-sm"><Mail className="w-4 h-4 text-primary" /> markimagem2014@gmail.com</p>
          <p className="flex items-center gap-2 text-sm mt-3 text-slate-400"><Phone className="w-4 h-4 text-primary" /> [telefone/WhatsApp do suporte]</p>
        </Panel>
      </div>
      <Panel title="Meus chamados">
        {items.length === 0 ? <Empty>Nenhum chamado aberto.</Empty> : (
          <ul className="divide-y divide-border" data-testid="support-tickets-list">
            {items.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex justify-between gap-2"><p className="font-semibold">{r.title}</p><StatusBadge status={r.status} /></div>
                <p className="text-xs text-slate-400">{fmtDateTime(r.created_at)}</p>
                {r.admin_notes && <p className="text-sm text-slate-300 mt-1">Resposta: {r.admin_notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
