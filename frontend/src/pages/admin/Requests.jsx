import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader, Panel, StatusBadge, Table, Td, Loading, Empty, NativeSelect, Field } from "@/components/common";
import { api, errMsg, fileUrl } from "@/lib/api";
import { fmtDate, fmtDateTime, LABELS } from "@/lib/format";

const RSTATUS = ["recebida", "em_revisao", "em_producao", "concluida", "rejeitada"];

function Detail({ req, onClose, onDone }) {
  const [st, setSt] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (req) {
      setSt(req.status);
      setNotes(req.admin_notes || "");
    }
  }, [req]);
  if (!req) return null;
  const save = async () => {
    try {
      await api.patch(`/admin/requests/${req.id}`, { status: st, admin_notes: notes });
      toast.success("Solicitação atualizada e cliente notificado");
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const convert = async () => {
    try {
      await api.post(`/admin/requests/${req.id}/convert`);
      toast.success(req.type === "novo" ? "Anúncio criado em rascunho. Gere o áudio em Anúncios." : "Anúncio atualizado (versão registrada). Gere/aprove novamente em Anúncios.");
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="bg-card w-full sm:max-w-lg overflow-y-auto" data-testid="request-detail-sheet">
        <SheetHeader><SheetTitle>{req.title}</SheetTitle></SheetHeader>
        <div className="space-y-4 mt-6 text-sm">
          <p><span className="text-slate-500">Cliente:</span> {req.business_name}</p>
          <p><span className="text-slate-500">Tipo:</span> {LABELS[req.type]} • <StatusBadge status={req.status} /></p>
          {(req.start_date || req.end_date) && <p><span className="text-slate-500">Período:</span> {fmtDate(req.start_date)} a {fmtDate(req.end_date)}</p>}
          {req.text && <div><p className="text-slate-500">Texto</p><p className="whitespace-pre-wrap">{req.text}</p></div>}
          {req.products && <div><p className="text-slate-500">Produtos e preços</p><p className="whitespace-pre-wrap">{req.products}</p></div>}
          {req.attachments?.length > 0 && <div><p className="text-slate-500">Anexos</p>{req.attachments.map((a, i) => <a key={a} href={fileUrl(a)} target="_blank" rel="noreferrer" className="text-primary block">Anexo {i + 1}</a>)}</div>}
          <div><p className="text-slate-500 mb-1">Andamento</p>{(req.timeline || []).map((t, i) => <p key={i} className="text-xs">{fmtDateTime(t.at)} — {LABELS[t.status]} {t.note && `• ${t.note}`}</p>)}</div>
          <Field label="Status"><NativeSelect testid="request-status-select" value={st} onChange={setSt}>{RSTATUS.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect></Field>
          <Field label="Observação para o cliente"><Textarea data-testid="request-notes-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="request-save-btn" onClick={save}>Salvar e notificar</Button>
            {req.type !== "suporte" && !req.resulting_ad_id && <Button data-testid="request-convert-btn" variant="secondary" onClick={convert}>{req.type === "novo" ? "Criar anúncio" : "Aplicar no anúncio"}</Button>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Requests() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ status: "", type: "" });
  const [sel, setSel] = useState(null);
  const load = useCallback(() => api.get("/admin/requests", { params: f }).then((r) => setRows(r.data)), [f]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div>
      <PageHeader title="Solicitações dos clientes" subtitle="Fluxo: solicitação → revisão → geração do áudio → aprovação → agendamento → veiculação → encerramento." />
      <Panel>
        <div className="grid sm:grid-cols-2 gap-3 mb-4 max-w-lg">
          <NativeSelect testid="requests-status-filter" value={f.status} onChange={(v) => setF({ ...f, status: v })}><option value="">Todos os status</option>{RSTATUS.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect>
          <NativeSelect testid="requests-type-filter" value={f.type} onChange={(v) => setF({ ...f, type: v })}><option value="">Todos os tipos</option>{["novo", "atualizacao", "renovacao", "suporte"].map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}</NativeSelect>
        </div>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nenhuma solicitação.</Empty> : (
          <Table cols={["Data", "Cliente", "Tipo", "Título", "Período", "Status"]} testid="requests-table">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-secondary/40 cursor-pointer" onClick={() => setSel(r)} data-testid={`request-row-${r.id}`}>
                <Td>{fmtDateTime(r.created_at)}</Td><Td className="font-semibold">{r.business_name}</Td><Td>{LABELS[r.type]}</Td><Td>{r.title}</Td>
                <Td className="whitespace-nowrap">{r.start_date || r.end_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : "—"}</Td><Td><StatusBadge status={r.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {sel && <Detail req={sel} onClose={() => setSel(null)} onDone={load} />}
    </div>
  );
}
