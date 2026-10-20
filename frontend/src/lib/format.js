export const brl = (v) =>
  v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10).split("-");
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : d;
};

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";

export const fmtDur = (s) => {
  s = Math.round(Number(s) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}:${String(sec).padStart(2, "0")}`;
};

export const LABELS = {
  rascunho: "Rascunho", aguardando_aprovacao: "Aguardando aprovação", aprovado: "Aprovado", agendado: "Agendado",
  em_veiculacao: "Em veiculação", pausado: "Pausado", expirado: "Expirado", rejeitado: "Rejeitado", arquivado: "Arquivado",
  teste: "Teste", ativa: "Ativa", pagamento_pendente: "Pagamento pendente", inadimplente: "Inadimplente",
  cancelamento_solicitado: "Cancelamento solicitado", cancelada: "Cancelada", encerrada: "Encerrada",
  recebida: "Recebida", em_revisao: "Em revisão", em_producao: "Em produção", concluida: "Concluída", rejeitada: "Rejeitada",
  pendente: "Pendente", recusado: "Recusado", estornado: "Estornado",
  pausada: "Pausada", retirada: "Retirada", indisponivel: "Indisponível",
  ativo: "Ativo", suspenso: "Suspenso", inativo: "Inativo",
  novo: "Novo anúncio", atualizacao: "Atualização", renovacao: "Renovação", suporte: "Suporte",
  superadmin: "Superadministrador", operador: "Operador de conteúdo", cliente: "Cliente",
};

const GREEN = ["em_veiculacao", "ativa", "aprovado", "concluida", "ativo"];
const AMBER = ["aguardando_aprovacao", "agendado", "pagamento_pendente", "teste", "recebida", "em_revisao", "em_producao", "pendente", "cancelamento_solicitado", "pausado", "pausada"];
const RED = ["expirado", "rejeitado", "inadimplente", "recusado", "rejeitada", "cancelada", "indisponivel", "suspenso"];

export const tone = (s) =>
  GREEN.includes(s) ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : AMBER.includes(s) ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
    : RED.includes(s) ? "bg-red-500/10 text-red-400 border-red-500/30"
    : "bg-slate-500/10 text-slate-300 border-slate-500/30";

export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export const AD_STYLES = ["Oferta urgente", "Promoção do dia", "Anúncio institucional", "Liquidação", "Inauguração",
  "Datas comemorativas", "Campanha de fim de semana", "Divulgação de novos produtos"];
