# Agenda Inteligente Urania

Painel web usado pelo time do Planetário Urania para organizar agenda, astrônomos, rotas e custos. Este documento serve tanto para quem mantém o código quanto para quem só precisa entender o que cada página faz.

## Visão geral
- Projeto estático (HTML, CSS, JS) servido via Nginx (ver `nginx.conf` e `Dockerfile`).
- Conecta-se a webhooks n8n para buscar/atualizar dados de astrônomos, agenda, despesas e imagens.
- Estilos em `css/` (arquivos migrados de `public/css`). Login usa `login.css`.

## Páginas e o que cada uma faz

### Painel RH — Astrônomos & Agenda (`rh-astronomos.html`)
**Para operação interna**: cadastrar/editar astrônomos e gerenciar agenda.

- Abas: **Astrônomos** e **Agenda**.
- Astrônomos:
  - Lista em cards com busca instantânea.
  - Criar, editar e excluir (individual ou em massa).
  - Importar CSV (envia arquivo direto para o webhook).
  - Campos de custos (combustível, hospedagem, alimentação, pedágios etc.) e IDs por tipo de tarefa.
  - Modal de edição individual e modal de edição em massa.
- Agenda:
  - Seleção de astrônomo (ao trocar, limpa filtros e já carrega).
  - Filtros: datas, tipo (padrão “Todos os eventos”), campo único com sugestões dinâmicas (cidades, escolas, nomes), busca livre; aplica em tempo real.
  - Cards por data (ordenados), com ID, escola, cidade, valor e tipo.
  - Ações: ver imagens (carrossel), lançar despesas, finalizar evento.
  - Modal do evento: detalhes completos, upload/listagem/exclusão de imagens (limite 10), carrossel popup.
- Imagens:
  - Upload por drag & drop ou seleção; consulta e exclusão via webhook (`add_img/delete_img/get_img`).
- APIs:
  - Astrônomos: `API_ASTRO_BASE` e fallback (`/webhook/novo-astronomo...`) para listar/adicionar/excluir/importar CSV e gerenciar imagens.
  - Agenda: `API_AGENDA` (`/webhook/agenda-astronomos`) para atualizar agenda, lançar despesas e finalizar eventos.

### Agenda do Astrônomo (`index.html`)
**Para o astrônomo**: consultar agenda, detalhes e rotas.
- Filtro de tipo: padrão “VISITA” (sincroniza IDs recebidos do backend).
- Mostra calendário, contagens e lista diária.
- Modal do evento:
  - Cabeçalho com data/cidade/tipo e links úteis (WhatsApp, rota, hotéis/restaurantes, ações de despesas/finalizar).
  - Bloco “Informações adicionais” (informacoes_adicionais/observacoes).
  - Galeria de imagens (carregar sob demanda).
  - Grid com todos os campos normalizados (coordenadas, custos, rota contínua).
- Rotas contínuas: calcula métricas e guarda cache/local overrides de rota.
- Persistência simples: filtro de tarefa, mês e dia selecionados no `localStorage`.

### Despesas (`despesas.html`)
**Para registrar custos** de eventos/astrônomos: combustível, hospedagem, pedágios, alimentação, monitor, outros. Envia ao webhook da agenda e mostra status de envio.

### Feedbacks (`feedbacks.html`)
Coleta/lista feedbacks de eventos. Modal traz NPS/nota/comentários e dados do evento.

### Histórico (`historico.html`)
Eventos finalizados. Filtros por período e tipo; mostra status, valores, escola e cidade, com link para detalhes.

### Conta (`account.html`)
Dados do astrônomo (nome, cidade base, veículo, consumo, custos médios). Permite editar e sincronizar com backend.

### Rotas (`rotas.html`)
Monta rotas a partir de eventos já carregados (cache em `localStorage`). Calcula distâncias/durações, considera rota contínua e retorno à base. Permite overrides manuais e salva em cache.

### Login (`login.html`)
Formulário simples de autenticação. Redireciona para as páginas principais após login.

## Como rodar localmente
1. Clonar o repositório.
2. Servir como site estático:
   - Rápido: `python3 -m http.server 8080` e abrir `http://localhost:8080`.
   - Ou usar `Dockerfile`/`nginx.conf` para subir um Nginx.
3. Ajustar URLs dos webhooks se necessário (já apontam para o n8n Urania).

## Como fazer deploy
### Usando Docker/Nginx (recomendado)
1. Build da imagem: `docker build -t urania-agenda:latest .`
2. Subir o container: `docker run -d --name urania-agenda -p 4000:4000 urania-agenda:latest`
3. Opcional: publicar a imagem em um registry e usar em plataformas como Coolify/Render/Portainer. A imagem não requer variáveis de ambiente.
4. Se precisar de rota base diferente, ajuste `nginx.conf` (diretiva `root`) ou o caminho de publicação na plataforma.
5. Para servir como página estática simples (sem fallback SPA), o `nginx.conf` já retorna 404 quando a rota não existir.

### Sem Docker (qualquer servidor estático)
- Copie todos os arquivos do repositório para o diretório público do servidor (ex.: `/usr/share/nginx/html`).
- Use o `nginx.conf` como base (1 bloco simples com `try_files $uri /index.html;`).
- Certifique-se de habilitar HTTPS e CORS conforme necessário no proxy/rede que protegerá os webhooks do n8n.

### URLs externas
- Os webhooks de produção já estão em `https://urania-planetario-n8n.mmjkgs.easypanel.host/...`.
- Se seu ambiente exigir outros endpoints, atualize as constantes `API_AGENDA`/`API_ASTRO_BASE` nos arquivos HTML antes do build/deploy.

## Endpoints externos (n8n)
- Astrônomos (CRUD/CSV/Imagens): `https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/novo-astronomo-1` (fallback `.../novo-astronomo`).
  - Ações POST JSON/FormData: `list`, `add`, `delete`, `import_csv`, `add_img`, `delete_img`, `get_img`.
- Agenda: `https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos`.
  - Ações: `action=atualizar_agenda`, `finalizar_evento`, `lancar_despesas` (GET ou POST).

> Observação: os webhooks podem exigir permissão/autenticação no ambiente final. Ajuste conforme a configuração do n8n.***
