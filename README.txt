AGENDA INTELIGENTE URANIA - GUIA DETALHADO
===========================================
Este texto replica o README principal, mas com explicações ampliadas de cada função, inclusive as menores. Serve para operação e manutenção.

VISÃO GERAL RÁPIDA
------------------
- Projeto estático (HTML, CSS, JS) servido via Nginx (ver nginx.conf e Dockerfile).
- Conecta-se a webhooks n8n para dados de astrônomos, agenda, despesas, imagens e rotas.
- Estilos em css/ (arquivos migrados de public/css). Login usa login.css.

PÁGINAS E FUNCIONALIDADES
-------------------------

Painel RH — Astrônomos & Agenda (rh-astronomos.html)
----------------------------------------------------
Uso interno: cadastrar/editar astrônomos, administrar agenda e imagens.

Abas e navegação
- Abas: Astrônomos e Agenda. Trocar de aba não perde filtros salvos; limpar astrônomo limpa filtros.
- Estado salvo em localStorage (aba ativa, datas, busca), mas ao trocar astrônomo filtros são limpos.

Gestão de Astrônomos
- Listagem em cards com busca instantânea por nome/usuário/cidade.
- Criar novo astrônomo: botão “Novo Astrônomo” abre modal para preencher todos os campos.
- Editar/excluir individualmente: clicar no card abre modal com campos editáveis e botão de exclusão.
- Edição em massa: modal “Editar Todos” permite alterar vários registros antes de salvar.
- Importação CSV: envia arquivo inteiro via FormData (action import_csv) para o webhook. Detecta delimitador, normaliza colunas e tenta mapear cidade/UF.
- Campos de custos: combustível (valor/litro, consumo km/l), hospedagem, alimentação, monitor, pedágios, porcentagem de lucro. Inclui IDs de tarefas (visita, pré, reserva, não marcar) para mapear com a agenda.

Agenda (RH)
- Seleção de astrônomo: obrigatório; ao trocar, limpa filtros e carrega automaticamente.
- Filtros:
  - Datas: início/fim.
  - Tipo de tarefa: padrão “Todos os eventos”.
  - Campo único com sugestões dinâmicas (cidades, escolas, nomes de leads) extraídas dos eventos carregados.
  - Busca livre: aplica em tempo real enquanto digita.
- Listagem: cards ordenados por data do evento; mostram ID, escola, cidade, valor e tipo.
- Ações por evento:
  - Ver imagens: abre carrossel em modal separado.
  - Lançar despesas: envia payload para webhook da agenda.
  - Finalizar evento: marca como finalizado no backend e remove da lista local.
- Modal de detalhes do evento:
  - Campos completos (data, escola, cidade, endereço, turno, número de alunos, conteúdo, responsável, telefone, valores, origem/destino, distâncias, texto da tarefa, avaliações).
  - Upload de imagens (drag & drop ou input), pré-visualização, exclusão e limite de 10 arquivos.

Imagens (RH)
- Upload: action add_img com até 10 arquivos (img1, img2...). Mostra “Enviando...” e recarrega prévia.
- Consulta: action get_img retorna links (normaliza lista, remove duplicados).
- Exclusão: action delete_img por URL/nome/linha; remove do DOM e mostra toast.
- Carrossel: navegação próxima/anterior, contador e exclusão direto do carrossel.

APIs usadas (RH)
- Astrônomos: API_ASTRO_BASE e fallback `/webhook/novo-astronomo...` para listar, adicionar, excluir, importar CSV e gerenciar imagens.
- Agenda: API_AGENDA `/webhook/agenda-astronomos` para atualizar agenda, lançar despesas e finalizar eventos.

Agenda do Astrônomo (index.html)
--------------------------------
Uso pelos astrônomos para ver agenda, detalhes e rotas.

Filtros e estado
- Filtro de tipo de tarefa: padrão “VISITA”. IDs sincronizados com a sessão retornada pelo backend; guarda no localStorage.
- Calendário: navegação de meses, seleção de dia, contagem de eventos. Estado salvo (mês e dia) no localStorage.

Lista e detalhes
- Carrega agenda via webhook, normaliza eventos e agrupa por dia.
- Renderiza lista diária e contador total.
- Modal do evento:
  - Cabeçalho: data, cidade, tipo, chips de coordenadas e IDs.
  - Responsável: nome e link de WhatsApp.
  - Informações adicionais: mostra informacoes_adicionais/observacoes preservando quebras de linha.
  - Links úteis: WhatsApp, rota (Google Maps), buscas de hotéis e restaurantes, botões “Lançar despesas” e “Finalizar”.
  - Imagens: botão para carregar galeria do evento; suporte a lightbox.
  - Grid detalhado: inclui coordenadas, custos, número de diárias, rota contínua, origem/destino, métricas de distância/duração (quando calculadas).

Rotas contínuas e cache
- Calcula métricas de rotas contínuas, aplica overrides salvos e guarda em cache local para reuso.
- Pode exportar dados para a página de rotas (rotas.html) usando o cache em localStorage.

Persistência
- Armazena no localStorage: filtro de tipo, mês/seleção do calendário, data selecionada.

Despesas (despesas.html)
------------------------
Uso para registrar custos reais por evento/astrônomo.
- Campos: combustível, hospedagem, pedágios, alimentação, monitor, outros.
- Envia via webhook da agenda; exibe status de envio e mensagens de erro/sucesso.

Feedbacks (feedbacks.html)
--------------------------
Coleta e exibe feedbacks de eventos.
- Listagem de feedbacks com resumo.
- Modal detalhado com NPS/nota/comentários e dados do evento associado.

Histórico (historico.html)
--------------------------
Lista de eventos finalizados/anteriores.
- Filtros por período e tipo de tarefa.
- Exibe status, valores, escola e cidade; link para visualizar detalhes.

Conta (account.html)
--------------------
Dados do astrônomo logado.
- Campos: nome, cidade base, veículo, consumo, custos médios.
- Permite editar e sincronizar com backend de astrônomos.

Rotas (rotas.html)
------------------
Calcula e visualiza rotas a partir de eventos já carregados (cache em localStorage).
- Considera rota contínua, retorno à base e overrides manuais.
- Salva ajustes no cache para reuso e compatibilidade com o painel principal.

Login (login.html)
------------------
Autenticação simples.
- Coleta credenciais e redireciona para as páginas principais.
- Usa login.css para estilo.

Execução local
--------------
1) Clonar o repositório.
2) Servir como site estático:
   - Rápido: python3 -m http.server 8080 e abrir http://localhost:8080
   - Ou usar Dockerfile/nginx.conf para subir um Nginx.
3) Ajustar URLs dos webhooks se necessário (já apontam para o n8n Urania).

Deploy
------
Opção recomendada (Docker/Nginx)
1) Construir imagem: `docker build -t urania-agenda:latest .`
2) Rodar: `docker run -d --name urania-agenda -p 4000:4000 urania-agenda:latest`
   - A imagem já inclui Nginx com `nginx.conf` (root em `/usr/share/nginx/html`, fallback `try_files`).
   - Não há variáveis de ambiente obrigatórias; os endpoints estão hardcoded.
3) Opcional: envie a imagem para seu registry e use em Coolify/Render/Portainer.
4) Se precisar mudar caminho raiz, edite `nginx.conf` antes do build (diretiva `root`) ou ajuste a publicação na plataforma.

Opção sem Docker (qualquer hosting estático)
- Copie todos os arquivos deste repositório para o diretório público (ex.: `/usr/share/nginx/html`).
- Use o `nginx.conf` como base (um servidor simples com `try_files $uri /index.html;`).
- Garanta HTTPS e CORS adequados no proxy/rede que ficará à frente do n8n.

URLs externas
- Webhooks padrão já apontam para `https://urania-planetario-n8n.mmjkgs.easypanel.host/...`.
- Se precisar mudar, altere as constantes `API_AGENDA`/`API_ASTRO_BASE` nos HTMLs antes do deploy.

Endpoints externos (n8n)
------------------------
- Astrônomos (CRUD/CSV/Imagens): https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/novo-astronomo-1 (fallback .../novo-astronomo)
  - Ações POST JSON/FormData: list, add, delete, import_csv, add_img, delete_img, get_img.
- Agenda: https://urania-planetario-n8n.mmjkgs.easypanel.host/webhook/agenda-astronomos
  - Ações: action=atualizar_agenda, finalizar_evento, lancar_despesas (GET ou POST).

Observação
----------
Os webhooks podem exigir autenticação ou permissões específicas no ambiente de produção. Ajuste conforme a configuração do n8n ou das chaves de acesso.
