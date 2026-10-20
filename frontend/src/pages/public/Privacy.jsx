import { Link } from "react-router-dom";
import { Logo } from "@/components/AppShell";

const SECTIONS = [
  ["Quem somos", "A MarkImagem Rádio Web é operada pela MarkImagem, controladora dos dados tratados nesta plataforma."],
  ["Dados coletados", "Nome, e-mail, telefone, dados do estabelecimento (nome, endereço, CNPJ, logotipo e segmento), dados de assinatura e pagamentos (processados pelo Mercado Pago; não armazenamos dados de cartão), solicitações e conteúdos de anúncios, histórico de reprodução da rádio e registros de acesso (logs)."],
  ["Finalidade", "Prestar o serviço de rádio comercial, produzir e veicular anúncios, cobrar a assinatura, prestar suporte, garantir a segurança e cumprir obrigações legais."],
  ["Base legal", "Execução de contrato, cumprimento de obrigação legal, legítimo interesse (segurança e prevenção a fraudes) e consentimento quando aplicável (ex.: gravações de voz)."],
  ["Compartilhamento", "Com o Mercado Pago (pagamentos), provedores de armazenamento em nuvem e serviços de síntese de voz e inteligência artificial usados na produção dos anúncios, sempre limitado ao necessário."],
  ["Segurança e acesso", "Senhas armazenadas com criptografia, sessões seguras, isolamento dos dados de cada estabelecimento, controle de acesso por perfil e registro de auditoria."],
  ["Retenção", "Os dados são mantidos enquanto a conta estiver ativa e pelo prazo necessário ao cumprimento de obrigações legais e fiscais. Dados de clientes inadimplentes ou cancelados não são excluídos automaticamente; a exclusão pode ser solicitada ao suporte."],
  ["Seus direitos", "Você pode acessar, corrigir, exportar (em 'Meu estabelecimento') e solicitar a exclusão dos seus dados, além de revogar consentimentos, entrando em contato pelo suporte."],
];

export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link to="/"><Logo /></Link>
      <h1 className="text-4xl font-bold mt-12">Política de Privacidade</h1>
      <p className="text-slate-400 mt-2">Tratamento de dados pessoais conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>
      <div className="space-y-8 mt-10" data-testid="privacy-content">
        {SECTIONS.map(([t, d]) => (
          <section key={t}><h2 className="text-lg font-semibold">{t}</h2><p className="text-slate-300 mt-2 leading-relaxed">{d}</p></section>
        ))}
      </div>
    </div>
  );
}
