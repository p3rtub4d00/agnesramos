# Convite animado da Agnes

Site de convite de aniversário com confirmação de presença, painel administrativo e consulta para portaria.

## Stack
- Node.js + Express no Render
- MongoDB Atlas para os dados
- GitHub para o código

## Configuração local
1. Instale Node.js 20 ou superior.
2. Execute `npm install`.
3. Configure as variáveis de ambiente descritas abaixo.
4. Execute `npm start`.

## Variáveis de ambiente no Render
- `MONGODB_URI`: string de conexão do MongoDB Atlas.
- `ADMIN_PASSWORD`: senha forte do painel administrativo.
- `PORTARIA_PASSWORD`: senha diferente para a portaria.
- `SESSION_SECRET`: segredo aleatório longo para assinar os tokens de acesso.
- `EVENT_NAME`: nome da aniversariante (padrão: Agnes).
- `EVENT_AGE`: idade (padrão: 5).
- `EVENT_DATE`: data exibida no convite (configure antes de publicar).
- `EVENT_TIME`: horário exibido no convite.
- `EVENT_ADDRESS`: endereço do evento.
- `EVENT_MAP_URL`: link do Google Maps, opcional.
- `RSVP_DEADLINE`: prazo de confirmação, opcional.
- `NODE_ENV`: use `production` no Render.

Sem `MONGODB_URI`, o site público ainda abre, mas o sistema informa que confirmações e consultas estão temporariamente indisponíveis. Configure o banco antes de divulgar o convite.

## Rotas
- `/`: convite público
- `/admin`: painel administrativo
- `/portaria`: consulta e registro de entrada
- `/api/health`: estado básico do serviço e do banco (não expõe credenciais)

## Segurança e operação
- As senhas são configuradas por variáveis de ambiente; não coloque credenciais no GitHub.
- O painel administrativo e a portaria têm autenticação separada.
- Exporte/imprima a lista antes do evento como contingência para falta de internet.
- Antes de divulgar, configure data, horário, endereço e teste uma confirmação real.
