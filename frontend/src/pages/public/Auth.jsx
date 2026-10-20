import { useState } from "react";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/AppShell";
import { Field } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { useAuth, homeFor } from "@/context/AuthContext";

const AuthFrame = ({ title, subtitle, children }) => (
  <div className="min-h-screen grid lg:grid-cols-2">
    <div className="flex flex-col justify-center px-6 sm:px-16 py-12">
      <Link to="/"><Logo /></Link>
      <div className="mt-12 max-w-md w-full fade-up">
        <h1 className="text-3xl sm:text-4xl font-bold">{title}</h1>
        {subtitle && <p className="text-slate-400 mt-2">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
    <div className="hidden lg:block relative">
      <img src="/hero-market.jpg" alt="Supermercado" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      <p className="absolute bottom-12 left-12 right-12 text-2xl font-display font-bold">"Atenção, clientes! Hoje tem oferta especial…"</p>
    </div>
  </div>
);

export function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user)} replace />;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(f.email, f.password);
      nav(homeFor(u));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Entrar" subtitle="Acesse sua rádio ou o painel administrativo.">
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <Field label="E-mail"><Input data-testid="login-email-input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Senha"><Input data-testid="login-password-input" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Button data-testid="login-form-submit-button" disabled={busy} className="w-full rounded-full h-11">{busy ? "Entrando…" : "Entrar"}</Button>
        <div className="flex justify-between text-sm">
          <Link to="/esqueci-senha" className="text-slate-400 hover:text-white" data-testid="forgot-password-link">Esqueci minha senha</Link>
          <Link to="/cadastro" className="text-primary hover:underline" data-testid="register-link">Criar conta</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

const SEGMENTS = ["Supermercado", "Açougue", "Mercearia", "Padaria", "Hortifrúti / FLV / Sacolão", "Distribuidora de bebidas", "Loja de conveniência", "Farmácia", "Restaurante e lanchonete", "Outro"];

export function Register() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", business_name: "", phone: "", segment: SEGMENTS[0], consent: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.consent) return toast.error("Aceite a Política de Privacidade para continuar.");
    if (f.password.length < 8) return toast.error("A senha deve ter ao menos 8 caracteres.");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/register", f);
      setUser(data);
      toast.success("Conta criada! Escolha seu plano.");
      nav("/cliente/assinatura");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Criar conta" subtitle="Cadastre seu estabelecimento e coloque sua rádio no ar.">
      <form onSubmit={submit} className="space-y-4" data-testid="register-form">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Seu nome"><Input data-testid="register-name-input" required value={f.name} onChange={set("name")} /></Field>
          <Field label="Telefone / WhatsApp"><Input data-testid="register-phone-input" value={f.phone} onChange={set("phone")} placeholder="(11) 99999-9999" /></Field>
        </div>
        <Field label="Nome do estabelecimento"><Input data-testid="register-business-input" required value={f.business_name} onChange={set("business_name")} /></Field>
        <Field label="Segmento">
          <select data-testid="register-segment-select" value={f.segment} onChange={set("segment")} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="E-mail"><Input data-testid="register-email-input" type="email" required value={f.email} onChange={set("email")} /></Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres"><Input data-testid="register-password-input" type="password" required value={f.password} onChange={set("password")} /></Field>
        <label className="flex items-start gap-3 text-sm text-slate-300">
          <Checkbox data-testid="register-consent-checkbox" checked={f.consent} onCheckedChange={(v) => setF({ ...f, consent: !!v })} className="mt-0.5" />
          <span>Li e aceito a <Link to="/privacidade" className="text-primary underline" target="_blank">Política de Privacidade</Link> e o tratamento dos meus dados conforme a LGPD.</span>
        </label>
        <Button data-testid="register-submit-btn" disabled={busy} className="w-full rounded-full h-11">{busy ? "Criando…" : "Criar conta"}</Button>
        <p className="text-sm text-slate-400">Já tem conta? <Link to="/login" className="text-primary">Entrar</Link></p>
      </form>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <AuthFrame title="Recuperar senha" subtitle="Informe seu e-mail cadastrado.">
      {sent ? (
        <div data-testid="forgot-password-sent" className="rounded-xl border border-border bg-card p-5 text-sm text-slate-300">
          Solicitação registrada. O envio automático por e-mail ainda não está ativo: a equipe MarkImagem recebe o link de redefinição e entrará em contato. Você também pode falar com o suporte.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail"><Input data-testid="forgot-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button data-testid="forgot-submit-btn" className="w-full rounded-full h-11">Solicitar redefinição</Button>
        </form>
      )}
      <Link to="/login" className="block mt-6 text-sm text-slate-400 hover:text-white">Voltar para o login</Link>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pwd, setPwd] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/auth/reset-password", { token: params.get("token"), password: pwd });
      toast.success("Senha redefinida. Faça login.");
      nav("/login");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <AuthFrame title="Nova senha">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha" hint="Mínimo de 8 caracteres"><Input data-testid="reset-password-input" type="password" minLength={8} required value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
        <Button data-testid="reset-submit-btn" className="w-full rounded-full h-11">Salvar nova senha</Button>
      </form>
    </AuthFrame>
  );
}
