import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, CalendarPlus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, StatusBadge, Empty, Loading, Field, NativeSelect } from "@/components/common";
import { api, errMsg, fileUrl } from "@/lib/api";
import { fmtDate, fmtDateTime, LABELS } from "@/lib/format";

const EMPTY = { type: "novo", title: "", category_id: "", text: "", products: "", start_date: "", end_date: "", ad_id: null, attachments: [] };

function RequestDialog({ open, onClose, initial, cats, onDone }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ ...EMPTY, ...initial });
  }, [open, initial]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const attach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/client/requests/upload", fd);
      setF((x) => ({ ...x, attachments: [...x.attachments, data.id] }));
      toast.success("Anexo enviado");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/client/requests", { ...f, category_id: f.category_id || null, start_date: f.start_date || null, end_date: f.end_date || null });
      toast.success("Solicitação enviada para a MarkImagem");
      onDone();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const isRenew = f.type === "renovacao";
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="ad-request-dialog">
        <DialogHeader><DialogTitle>{LABELS[f.type]}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Field label="Título"><Input data-testid="ad-request-title-input" required value={f.title} onChange={set("title")} placeholder="Ex.: Oferta de carnes do fim de semana" /></Field></div>
          {!isRenew && <>
            <Field label="Categoria">
              <NativeSelect testid="ad-request-category-select" value={f.category_id} onChange={(v) => setF({ ...f, category_id: v })}>
                <option value="">Selecione</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <div />
            <div className="sm:col-span-2"><Field label="Texto desejado"><Textarea data-testid="ad-request-text-input" rows={4} value={f.text} onChange={set("text")} placeholder="Atenção, clientes! Hoje tem oferta especial…" /></Field></div>
            <div className="sm:col-span-2"><Field label="Produtos e preços"><Textarea data-testid="ad-request-products-input" rows={3} value={f.products} onChange={set("products")} placeholder="Coxão mole R$ 34,90/kg; Picanha R$ 69,90/kg" /></Field></div>
          </>}
          <Field label="Início da promoção"><Input data-testid="ad-request-start-input" type="date" value={f.start_date || ""} onChange={set("start_date")} /></Field>
          <Field label={isRenew ? "Nova validade" : "Fim da promoção"}><Input data-testid="ad-request-end-input" type="date" required={isRenew} value={f.end_date || ""} onChange={set("end_date")} /></Field>
          {!isRenew && <div className="sm:col-span-2"><Field label="Arquivos e referências (imagem, áudio ou PDF)" hint={`${f.attachments.length} anexo(s)`}><Input data-testid="ad-request-attachment-input" type="file" onChange={attach} /></Field></div>}
          <div className="sm:col-span-2"><Button data-testid="ad-request-submit-btn" disabled={busy} className="rounded-full">{busy ? "Enviando…" : "Enviar solicitação"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdCard({ a, onRequest, onApprove }) {
  return (
    <div className="rounded-2xl border border-border p-5 space-y-3" data-testid={`client-ad-card-${a.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold">{a.title}</p><p className="text-xs text-slate-400 mt-1">Validade: {fmtDate(a.start_date)} a {fmtDate(a.end_date)}</p></div>
        <StatusBadge status={a.status} />
      </div>
      {a.text && <p className="text-sm text-slate-300 line-clamp-3">{a.text}</p>}
      {a.audio_file_id && <audio controls preload="none" src={fileUrl(a.audio_file_id)} className="w-full h-10" data-testid={`client-ad-audio-${a.id}`} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" data-testid={`client-ad-update-btn-${a.id}`} onClick={() => onRequest({ type: "atualizacao", ad_id: a.id, title: `Atualização: ${a.title}`, text: a.text })}><RefreshCw className="w-3.5 h-3.5 mr-1" />Atualizar</Button>
        <Button size="sm" variant="secondary" data-testid={`client-ad-renew-btn-${a.id}`} onClick={() => onRequest({ type: "renovacao", ad_id: a.id, title: `Renovação: ${a.title}` })}><CalendarPlus className="w-3.5 h-3.5 mr-1" />Renovar</Button>
        {a.client_approval_required && a.audio_file_id && !a.client_approved_at && <Button size="sm" data-testid={`client-ad-approve-btn-${a.id}`} onClick={() => onApprove(a)}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Aprovar prévia</Button>}
      </div>
    </div>
  );
}

export default function ClientAds() {
  const [ads, setAds] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [cats, setCats] = useState([]);
  const [dlg, setDlg] = useState(null);
  const load = useCallback(async () => {
    const [a, r, c] = await Promise.all([api.get("/client/ads"), api.get("/client/requests"), api.get("/categories")]);
    setAds(a.data);
    setReqs(r.data.filter((x) => x.type !== "suporte"));
    setCats(c.data);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const approve = async (a) => {
    try {
      await api.post(`/client/ads/${a.id}/approve-preview`);
      toast.success("Prévia aprovada");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (!ads) return <Loading />;
  return (
    <div>
      <PageHeader title="Meus anúncios" subtitle="Solicite, atualize e acompanhe seus anúncios. Ofertas vencidas saem do ar automaticamente.">
        <Button data-testid="client-new-ad-request-btn" className="rounded-full" onClick={() => setDlg({ type: "novo" })}><Plus className="w-4 h-4 mr-1" />Solicitar anúncio</Button>
      </PageHeader>
      <Tabs defaultValue="ads">
        <TabsList className="mb-6"><TabsTrigger value="ads" data-testid="tab-my-ads">Anúncios ({ads.length})</TabsTrigger><TabsTrigger value="reqs" data-testid="tab-my-requests">Solicitações ({reqs.length})</TabsTrigger></TabsList>
        <TabsContent value="ads">
          {ads.length === 0 ? <Empty>Nenhum anúncio ainda. Clique em "Solicitar anúncio".</Empty> :
            <div className="grid md:grid-cols-2 gap-4">{ads.map((a) => <AdCard key={a.id} a={a} onRequest={setDlg} onApprove={approve} />)}</div>}
        </TabsContent>
        <TabsContent value="reqs">
          <Panel>
            {reqs.length === 0 ? <Empty>Nenhuma solicitação enviada.</Empty> : (
              <ul className="divide-y divide-border" data-testid="client-requests-list">
                {reqs.map((r) => (
                  <li key={r.id} className="py-4">
                    <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{r.title}</p><StatusBadge status={r.status} /></div>
                    <p className="text-xs text-slate-400 mt-1">{LABELS[r.type]} • enviada em {fmtDateTime(r.created_at)}</p>
                    {r.admin_notes && <p className="text-sm text-slate-300 mt-2">MarkImagem: {r.admin_notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
      <RequestDialog open={!!dlg} initial={dlg} cats={cats} onClose={() => setDlg(null)} onDone={load} />
    </div>
  );
}
