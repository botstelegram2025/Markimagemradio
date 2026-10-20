import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, Navigate } from "react-router-dom";
import {
  LayoutDashboard, Users, CreditCard, Wallet, Library, ListMusic, Timer, Megaphone, Mic, Inbox, BarChart3,
  ShieldCheck, Settings, ScrollText, Radio, Receipt, History, Store, LifeBuoy, LogOut, Bell, Menu, X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { RadioProvider } from "@/context/RadioContext";
import { MiniPlayer } from "@/components/RadioPlayer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { fmtDateTime, LABELS } from "@/lib/format";
import { Loading } from "@/components/common";

const ADMIN_NAV = [
  ["dashboard", "Dashboard", "/admin", LayoutDashboard, "all"],
  ["clientes", "Clientes", "/admin/clientes", Users, "all"],
  ["planos", "Planos e assinaturas", "/admin/planos", CreditCard, "super"],
  ["financeiro", "Financeiro", "/admin/financeiro", Wallet, "super"],
  ["musicas", "Biblioteca musical", "/admin/musicas", Library, "all"],
  ["programacao", "Programação da rádio", "/admin/programacao", ListMusic, "all"],
  ["intervalos", "Intervalos comerciais", "/admin/intervalos", Timer, "all"],
  ["anuncios", "Anúncios", "/admin/anuncios", Megaphone, "all"],
  ["voz", "Voz oficial", "/admin/voz", Mic, "all"],
  ["solicitacoes", "Solicitações dos clientes", "/admin/solicitacoes", Inbox, "all"],
  ["relatorios", "Relatórios", "/admin/relatorios", BarChart3, "all"],
  ["usuarios", "Usuários e permissões", "/admin/usuarios", ShieldCheck, "super"],
  ["configuracoes", "Configurações", "/admin/configuracoes", Settings, "super"],
  ["logs", "Logs e monitoramento", "/admin/logs", ScrollText, "super"],
];

const CLIENT_NAV = [
  ["radio", "Minha Rádio", "/cliente", Radio],
  ["assinatura", "Minha assinatura", "/cliente/assinatura", CreditCard],
  ["anuncios", "Meus anúncios", "/cliente/anuncios", Megaphone],
  ["historico", "Histórico de veiculação", "/cliente/historico", History],
  ["pagamentos", "Pagamentos", "/cliente/pagamentos", Receipt],
  ["estabelecimento", "Meu estabelecimento", "/cliente/estabelecimento", Store],
  ["suporte", "Suporte", "/cliente/suporte", LifeBuoy],
];

export const Logo = ({ small }) => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    <div className="relative w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-red-700/30">
      <Radio className="w-5 h-5 text-white" />
      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent border-2 border-background" />
    </div>
    <div className="leading-none">
      <p className="font-display font-extrabold text-lg tracking-tight">Mark<span className="text-primary">Imagem</span></p>
      {!small && <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400 mt-0.5">Rádio Web</p>}
    </div>
  </div>
);

function Notifications() {
  const [data, setData] = useState({ items: [], unread: 0 });
  const load = () => api.get("/notifications").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const readAll = async () => {
    await api.post("/notifications/read-all");
    load();
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid="notifications-bell-btn" aria-label="Notificações" className="relative w-10 h-10 rounded-full hover:bg-secondary flex items-center justify-center">
          <Bell className="w-5 h-5" />
          {data.unread > 0 && <span data-testid="notifications-unread-count" className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-bold flex items-center justify-center">{data.unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="font-semibold text-sm">Notificações</p>
          <button data-testid="notifications-read-all-btn" onClick={readAll} className="text-xs text-primary hover:underline">Marcar como lidas</button>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {data.items.length === 0 && <p className="text-sm text-slate-500 p-4">Sem notificações.</p>}
          {data.items.map((n) => (
            <div key={n.id} className={`px-4 py-3 text-sm ${n.read ? "opacity-60" : ""}`}>
              <p className="font-semibold">{n.title}</p>
              <p className="text-slate-400 text-xs mt-0.5">{n.message}</p>
              <p className="text-[10px] text-slate-500 mt-1">{fmtDateTime(n.created_at)}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Sidebar({ items, open, onClose, user, onLogout }) {
  return (
    <aside className={`fixed md:sticky top-0 z-40 h-screen w-72 md:w-64 shrink-0 bg-[#080c13] border-r border-border flex flex-col transition-transform md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between p-5">
        <Logo />
        <button className="md:hidden" onClick={onClose} aria-label="Fechar menu" data-testid="sidebar-close-btn"><X className="w-5 h-5" /></button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 space-y-0.5">
        {items.map(([key, label, to, Icon]) => (
          <NavLink key={key} to={to} end={to === "/admin" || to === "/cliente"} onClick={onClose} data-testid={`sidebar-nav-item-${key}`}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary text-white shadow-md shadow-red-900/30" : "text-slate-300 hover:bg-secondary hover:text-white"}`}>
            <Icon className="w-4 h-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-border">
        <p className="text-sm font-semibold truncate">{user.name}</p>
        <p className="text-xs text-slate-500 truncate">{user.business?.name || LABELS[user.role]}</p>
        <button data-testid="logout-btn" onClick={onLogout} className="mt-3 flex items-center gap-2 text-sm text-slate-400 hover:text-white"><LogOut className="w-4 h-4" /> Sair</button>
      </div>
    </aside>
  );
}

function Shell({ items, topExtra }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const onLogout = async () => {
    await logout();
    nav("/login");
  };
  return (
    <div className="min-h-screen flex">
      {open && <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setOpen(false)} />}
      <Sidebar items={items} open={open} onClose={() => setOpen(false)} user={user} onLogout={onLogout} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 h-16 flex items-center justify-between gap-3 px-4 sm:px-8 bg-background/80 backdrop-blur-xl border-b border-border">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu" data-testid="sidebar-open-btn"><Menu className="w-6 h-6" /></button>
          <div className="flex-1 flex items-center">{topExtra}</div>
          <Notifications />
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-10 max-w-[1400px] w-full"><Outlet /></main>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "cliente") return <Navigate to="/cliente" replace />;
  const items = ADMIN_NAV.filter((n) => n[4] === "all" || user.role === "superadmin");
  return <Shell items={items} />;
}

export function ClientLayout() {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "cliente") return <Navigate to="/admin" replace />;
  return (
    <RadioProvider>
      <Shell items={CLIENT_NAV} topExtra={<MiniPlayer />} />
    </RadioProvider>
  );
}

export const SuperOnly = ({ children }) => {
  const { user } = useAuth();
  return user?.role === "superadmin" ? children : <Navigate to="/admin" replace />;
};
