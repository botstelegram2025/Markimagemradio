import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Radio, Megaphone, CalendarClock, Mic, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/AppShell";
import { api } from "@/lib/api";
import { brl } from "@/lib/format";
import { useAuth, homeFor } from "@/context/AuthContext";

const FEATURES = [
  [Radio, "Rádio própria no ar", "Programação musical contínua, montada no servidor, com seus anúncios intercalados."],
  [Megaphone, "Anúncios com a voz oficial", "Ofertas gravadas pela locução MarkImagem, prontas em poucas horas."],
  [CalendarClock, "Validade automática", "Oferta venceu, saiu do ar. Nada de promoção antiga tocando por engano."],
  [Mic, "Você pede, nós produzimos", "Solicite novos anúncios e atualizações direto pelo painel."],
];

function PlanCard({ p, i }) {
  const price = p.promo_price || p.price;
  return (
    <div data-testid={`public-plan-card-${i}`} className={`rounded-3xl border p-7 flex flex-col fade-up ${i === 1 ? "border-primary bg-primary/10" : "border-border bg-card"}`} style={{ animationDelay: `${i * 80}ms` }}>
      <h3 className="text-xl font-bold">{p.name}</h3>
      <p className="text-sm text-slate-400 mt-2 min-h-[40px]">{p.description}</p>
      <div className="mt-6">
        {p.promo_price ? <p className="text-sm text-slate-500 line-through">{brl(p.price)}</p> : null}
        <p className="text-4xl font-extrabold font-display">{price > 0 ? brl(price) : "Sob consulta"}<span className="text-sm font-medium text-slate-400">{price > 0 ? (p.billing_period_months > 1 ? ` / ${p.billing_period_months} meses` : " / mês") : ""}</span></p>
        {p.trial_days > 0 && <p className="text-xs text-accent mt-1">{p.trial_days} dias de teste</p>}
      </div>
      <ul className="mt-6 space-y-2 text-sm flex-1">
        <li className="flex gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />{p.max_active_ads ? `${p.max_active_ads} anúncios ativos` : "Anúncios sob medida"}</li>
        <li className="flex gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />{p.max_requests_month ? `${p.max_requests_month} solicitações por mês` : "Solicitações sob medida"}</li>
        {p.can_request_updates && <li className="flex gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />Atualização de ofertas</li>}
        {p.support_type && <li className="flex gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />Atendimento: {p.support_type}</li>}
        {(p.features || []).map((f) => <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-primary mt-0.5" />{f}</li>)}
      </ul>
      <Link to="/cadastro" className="mt-8"><Button data-testid={`public-plan-cta-${i}`} className="w-full rounded-full" variant={i === 1 ? "default" : "secondary"}>Contratar</Button></Link>
    </div>
  );
}

export default function Landing() {
  const [plans, setPlans] = useState([]);
  const { user } = useAuth();
  useEffect(() => {
    api.get("/plans").then((r) => setPlans(r.data)).catch(() => {});
  }, []);
  return (
    <div className="min-h-screen">
      <header className="max-w-7xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-2 sm:gap-4 text-sm">
          <a href="#planos" className="hidden sm:inline text-slate-300 hover:text-white" data-testid="nav-plans-link">Planos</a>
          {user ? <Link to={homeFor(user)}><Button data-testid="nav-panel-btn" className="rounded-full">Meu painel</Button></Link> : <>
            <Link to="/login" data-testid="nav-login-link" className="text-slate-300 hover:text-white">Entrar</Link>
            <Link to="/cadastro"><Button data-testid="nav-register-btn" className="rounded-full">Criar conta</Button></Link>
          </>}
        </nav>
      </header>

      <section className="max-w-7xl mx-auto px-5 sm:px-8 pt-10 pb-24 grid lg:grid-cols-[1.1fr_.9fr] gap-12 items-center">
        <div className="fade-up">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500 onair-dot" /> Rádio comercial no ar
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold mt-6 leading-[1.05]">A rádio da sua loja,<br />com as <span className="text-primary">suas ofertas</span><br />na voz certa.</h1>
          <p className="text-slate-300 text-base md:text-lg mt-6 max-w-xl">Para supermercados, açougues, padarias, hortifrutis, distribuidoras e conveniências. Música ambiente o dia todo e anúncios personalizados que entram e saem do ar sozinhos.</p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link to="/cadastro"><Button data-testid="hero-cta-register" size="lg" className="rounded-full px-7">Quero minha rádio <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
            <a href="#planos"><Button data-testid="hero-cta-plans" size="lg" variant="secondary" className="rounded-full px-7">Ver planos</Button></a>
          </div>
        </div>
        <div className="relative fade-up" style={{ animationDelay: "120ms" }}>
          <div className="absolute -inset-6 bg-primary/20 blur-3xl rounded-full" />
          <img src="/hero-studio.jpg" alt="Estúdio de locução MarkImagem" className="relative rounded-3xl border border-border aspect-[4/3] object-cover w-full" />
          <div className="absolute -bottom-6 -left-4 sm:-left-8 bg-card/90 backdrop-blur-xl border border-border rounded-2xl p-4 flex items-center gap-3 shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center"><Megaphone className="w-5 h-5" /></div>
            <div><p className="text-xs text-slate-400">Tocando agora</p><p className="text-sm font-semibold">Oferta do Açougue — até sábado</p></div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 sm:px-8 pb-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {FEATURES.map(([Icon, t, d], i) => (
          <div key={t} className="rounded-2xl border border-border bg-card p-6 fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <Icon className="w-6 h-6 text-primary" />
            <h3 className="font-semibold mt-4">{t}</h3>
            <p className="text-sm text-slate-400 mt-2">{d}</p>
          </div>
        ))}
      </section>

      <section id="planos" className="max-w-7xl mx-auto px-5 sm:px-8 pb-24">
        <h2 className="text-3xl sm:text-4xl font-bold">Planos</h2>
        <p className="text-slate-400 mt-2">Assinatura mensal pelo Mercado Pago. Cancele quando quiser.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 mt-10" data-testid="public-plans-list">
          {plans.length === 0 && <p className="text-slate-500 text-sm">Os planos estão sendo atualizados. Crie sua conta e fale com a MarkImagem.</p>}
          {plans.map((p, i) => <PlanCard key={p.id} p={p} i={i} />)}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row gap-4 justify-between text-sm text-slate-500">
          <Logo small />
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Dados protegidos (LGPD)</span>
            <Link to="/privacidade" className="hover:text-white" data-testid="footer-privacy-link">Política de Privacidade</Link>
          </div>
          <p>© {new Date().getFullYear()} MarkImagem</p>
        </div>
      </footer>
    </div>
  );
}
