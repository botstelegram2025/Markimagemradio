# MarkImagem Rádio Web — PRD

## Original problem statement
PROJETO: MARKIMAGEM RÁDIO WEB — Plataforma SaaS de rádio comercial personalizada para estabelecimentos (supermercados, açougues, mercearias, padarias, hortifrutis, distribuidoras, conveniências). Sistema real com banco persistente, autenticação, backend, frontend, processamento de áudio, pagamentos (Mercado Pago recorrente) e reprodução musical funcional. Perfis superadmin / cliente assinante / operador de conteúdo. Módulos: dashboard, clientes, planos e assinaturas, financeiro, biblioteca musical (lote/ZIP, playlist 12h com pacote mais recente primeiro), programação, intervalos comerciais, anúncios (status, validade automática, versões), Minha Voz MarkImagem (gravação no navegador, consentimento, clonagem de voz autorizada, TTS pt-BR com velocidade/pausas/pronúncias, sem substituição silenciosa por voz genérica), assistente de textos publicitários, solicitações dos clientes, relatórios + CSV, usuários/permissões, configurações, logs, notificações, LGPD. (Texto completo enviado pelo usuário na primeira mensagem.)

## User choices
- Voz: ElevenLabs desejado, mas usuário quer menor custo e não forneceu chave → voz PROVISÓRIA OpenAI TTS (chave Emergent), clonagem ElevenLabs pronta para ativar via chave em Configurações.
- Textos: Claude (claude-sonnet-5-5) via chave Emergent.
- Mercado Pago: credenciais cadastradas pelo painel admin (criptografadas no backend).
- Auth: JWT e-mail/senha. E-mail: não configurado (notificações internas).
- Superadmin: markimagem2014@gmail.com

## Architecture
- FastAPI (core.py, routes_auth/admin/billing/music/ads/radio.py, tts.py) + MongoDB (UUID ids) + Emergent Object Storage para áudios/logos.
- Motor de rádio no servidor por estabelecimento (radio_states): decide o próximo item (música da playlist ativa ou intervalo de anúncios), revalida validade no momento da entrega (fila antiga nunca toca anúncio vencido), registra playback_history. Cliente usa HTTP audio com Range, reconexão automática. (Não usa Icecast; transmissão personalizada por cliente evita vazamento de anúncios.)
- Cron da plataforma (.emergent/crons.yml, a cada 15 min) → /api/cron/tick: expira anúncios, inicia agendados, alerta vencimentos, trata trial/cancelamento/inadimplência.
- React + shadcn, tema escuro, Outfit/Manrope.

## Implemented (2026-10-20)
- Auth JWT cookies, refresh, lockout 5 tentativas, reset de senha (link registrado na auditoria), troca de senha, LGPD consentimento + exportação + política.
- Admin completo (14 menus), operador sem financeiro/configurações.
- Planos CRUD (seed 4 planos sem preço, não publicados), trial, checkout MP preapproval, sync backend, cancelamento, webhook com HMAC x-signature + idempotência, pagamentos/recibos.
- Biblioteca: upload MP3 lote/ZIP, validação, duplicadas (sha1), capa ID3, exclusão lógica, verificação, playlist 12h versionada.
- Intervalos: a cada N/tempo/personalizado, por intervalo, duração máx, por hora, ordem, categorias prioritárias, pico/baixa, campanha, pausa, repetição; override por cliente.
- Anúncios: editor, IA Claude streaming, TTS (normalização de preços/datas, pronúncias, pausas, velocidade), upload MP3, aprovação, publicação, versões antes/depois, limite de plano, custo/consumo.
- Voz: perfis com consentimento, gravação MediaRecorder (pausar/continuar/regravar/prévia), upload, exclusão, clonagem ElevenLabs (requer chave), teste de voz.
- Cliente: Minha Rádio (player + mini player persistente), assinatura, anúncios/solicitações/renovação/aprovação de prévia, histórico, pagamentos, estabelecimento/logo, suporte.
- Relatórios (11) + CSV, logs auditoria/erros/streaming, backup JSON, notificações internas.
- Testes: iteration_1 backend 42/42, frontend fluxos OK.

## Backlog
- P0: Usuário definir preços/publicar planos; cadastrar credenciais Mercado Pago e webhook; chave ElevenLabs para voz oficial; importar músicas licenciadas.
- P1: E-mail transacional (Resend); seletores de data pt-BR (shadcn Calendar); streaming de arquivos grandes sem carregar em memória.
- P2: Icecast compartilhado opcional; app PWA; relatórios gráficos.
