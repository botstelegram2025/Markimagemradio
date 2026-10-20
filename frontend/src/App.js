import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { AdminLayout, ClientLayout, SuperOnly } from "@/components/AppShell";
import Landing from "@/pages/public/Landing";
import { Login, Register, ForgotPassword, ResetPassword } from "@/pages/public/Auth";
import Privacy from "@/pages/public/Privacy";
import Dashboard from "@/pages/admin/Dashboard";
import Clients from "@/pages/admin/Clients";
import Plans from "@/pages/admin/Plans";
import Finance from "@/pages/admin/Finance";
import Music from "@/pages/admin/Music";
import Programming from "@/pages/admin/Programming";
import Breaks from "@/pages/admin/Breaks";
import Ads from "@/pages/admin/Ads";
import Voice from "@/pages/admin/Voice";
import Requests from "@/pages/admin/Requests";
import Reports from "@/pages/admin/Reports";
import UsersPage from "@/pages/admin/Users";
import SettingsPage from "@/pages/admin/Settings";
import Logs from "@/pages/admin/Logs";
import ClientHome from "@/pages/client/Home";
import ClientSubscription from "@/pages/client/Subscription";
import ClientAds from "@/pages/client/MyAds";
import ClientHistory from "@/pages/client/History";
import ClientPayments from "@/pages/client/Payments";
import ClientBusiness from "@/pages/client/Business";
import ClientSupport from "@/pages/client/Support";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="clientes" element={<Clients />} />
            <Route path="planos" element={<SuperOnly><Plans /></SuperOnly>} />
            <Route path="financeiro" element={<SuperOnly><Finance /></SuperOnly>} />
            <Route path="musicas" element={<Music />} />
            <Route path="programacao" element={<Programming />} />
            <Route path="intervalos" element={<Breaks />} />
            <Route path="anuncios" element={<Ads />} />
            <Route path="voz" element={<Voice />} />
            <Route path="solicitacoes" element={<Requests />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="usuarios" element={<SuperOnly><UsersPage /></SuperOnly>} />
            <Route path="configuracoes" element={<SuperOnly><SettingsPage /></SuperOnly>} />
            <Route path="logs" element={<SuperOnly><Logs /></SuperOnly>} />
          </Route>
          <Route path="/cliente" element={<ClientLayout />}>
            <Route index element={<ClientHome />} />
            <Route path="assinatura" element={<ClientSubscription />} />
            <Route path="anuncios" element={<ClientAds />} />
            <Route path="historico" element={<ClientHistory />} />
            <Route path="pagamentos" element={<ClientPayments />} />
            <Route path="estabelecimento" element={<ClientBusiness />} />
            <Route path="suporte" element={<ClientSupport />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" theme="dark" />
    </AuthProvider>
  );
}
