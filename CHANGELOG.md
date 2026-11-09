# CHANGELOG — elo.

Histórico de versões do controle financeiro pessoal e em casal.

---

## [1.0.0] — 2026-11-09

Primeira versão completa do sistema.

### Backend (FastAPI + PostgreSQL)

#### Autenticação
- Registro e login de usuários com JWT (`python-jose` + `passlib/bcrypt`)
- Token armazenado no frontend via `localStorage` como `elo_token`
- Middleware `obter_usuario_atual` protege todas as rotas autenticadas

#### Módulo: Despesas (`/api/despesas`)
- CRUD completo de despesas pessoais
- Tipos de recorrência: diário, semanal, quinzenal, mensal, trimestral, semestral, anual
- Expansão virtual de despesas recorrentes por mês/ano (sem duplicar registros)
- Divisão de despesas com outro usuário (email + porcentagem)
- Fluxo de aprovação: aguardando → de acordo / negado (com justificativa)
- Endpoint `/pendentes` para modal bloqueante de aprovação

#### Módulo: Receitas (`/api/receitas`)
- CRUD completo de receitas com suporte a recorrência
- Resumo mensal: total, recebido, pendente, quantidade
- Mesmo padrão de expansão virtual das despesas

#### Módulo: Dashboard (`/api/dashboard`)
- Resumo consolidado em uma única chamada: receitas, despesas, saldo, balanço do casal
- Lançamentos recentes misturados (despesas + receitas) ordenados por data

#### Módulo: Conquistas (`/api/conquistas`)
- Metas de poupança com emoji, prazo e valor alvo
- Aportes individuais rastreados (histórico completo)
- Acumulado calculado dinamicamente (soma dos aportes, nunca armazenado)
- Soft delete (arquivar) e hard delete com cascade
- Endpoints: criar, listar, editar, arquivar, remover, registrar aporte, remover aporte

#### Módulo: Cartões (`/api/cartoes`)
- CRUD de cartões de crédito (banco, limite, dia de fechamento, dia de vencimento)
- Lançamentos parcelados: `valor_parcela`, `parcela_inicial`, `parcela_final`, `data_compra`
- Cálculo automático de qual parcela cai em qual mês/ano com base no fechamento e vencimento
- Regra: se `vencimento > fechamento` → vence no mesmo mês do ciclo; senão → mês seguinte
- Toggle de situação por parcela (pago / pendente)
- Divisão de lançamentos com parceiro (mesmo padrão de aprovação das despesas)
- Endpoint `/lancamentos/pendentes` integrado ao modal bloqueante do shell

#### Banco de dados
- PostgreSQL 16 com SQLAlchemy 2.0 (mapped_column style)
- Tabelas criadas automaticamente via `Base.metadata.create_all` no startup
- Tabelas: `usuarios`, `despesas`, `despesa_divisoes`, `receitas`, `conquistas`, `aportes`, `cartoes`, `cartao_lancamentos`
- Enums PostgreSQL nativos: `recorrencia_tipo`, `situacao_despesa`, `status_divisao`, `situacao_receita`, `situacao_lancamento`, `status_divisao_cartao`

---

### Frontend (Angular 19 + SCSS)

#### Design System (`DESIGN.md`)
- Tipografia: Crimson Pro (serif) + JetBrains Mono (mono)
- Paleta: Parchment `#F5F0E8` (fundo), Lake Blue `#2563EB` (CTA), Off-Black `#1C1C1E`, Mint `#A7FCCD`, Coral `#FF9473`, Gold `#ECDA98`, Periwinkle Mist `#DDE4FF`
- Cards: 40px radius, sem sombras, borda `1px solid var(--color-ash)`
- Botões: 100px radius (pill)
- Todos os cards são clicáveis (hover + ação)
- Todas as tabelas têm colunas ordenáveis (sinal ↕/↑/↓ no header)

#### Shell e Layout
- `ShellComponent`: topbar com logo, links de navegação, nome do usuário e botão sair
- Modal bloqueante de aprovação: aparece ao logar se houver pendências (despesas + cartões)
- Modal unificado: trata `DespesaDivisao` e `CartaoLancamento` no mesmo componente
- Verificação via `forkJoin` paralelo ao iniciar sessão

#### Página: Dashboard (`/dashboard`)
- Navegação de mês (anterior / próximo)
- 4 tiles: Saldo do Mês, Receitas, Despesas, A Pagar
- Balanço do casal (apenas quando há despesas compartilhadas)
- Lançamentos recentes: mistura despesas (negativo) e receitas (positivo), top 8 por data

#### Página: Despesas (`/despesas`)
- 3 cards de resumo: total, pago, pendente
- Filtro rápido: Todos / Pendente / Pago
- Tabela ordenável: data, descrição, valor, recorrência, situação
- Remoção com confirmação inline (linha substituída por confirmação)
- Modal de criação/edição

#### Página: Receitas (`/receitas`)
- Mesma estrutura das Despesas com esquema de cores Mint
- Situação: recebido / pendente (nomenclatura diferente de Despesas)
- Resumo via endpoint `/resumo` do servidor

#### Página: Casal (`/casal`)
- Cards de balanço mensal (Periwinkle Mist / Coral dependendo do saldo)
- Navegação de mês
- Tabela com 6 colunas: data, descrição, valor, minha parte, situação, status divisão
- Modal com toggle "Dividir despesa" → campos de email + porcentagem

#### Página: Conquistas (`/conquistas`)
- Grid de cards com barra de progresso colorida por nível (Coral < 30%, Mint > 80%, Gold intermediário)
- Resumo geral: total acumulado vs total das metas
- Painel lateral de detalhe: histórico de aportes, formulário de novo aporte
- Modal de criação/edição de meta
- Remoção com confirmação inline sobreposta ao card

#### Página: Cartões (`/cartoes`)
- Chips de seleção de cartão (com editar/remover por chip)
- Navegação de mês + 3 tiles: total da fatura, pago, a pagar
- Tabela: vencimento, descrição, parcelas (ex: 3/12), valor, dividido (%), situação clicável
- Toggle de situação diretamente na tabela (clique no badge pago/pendente)
- Modal de lançamento: toggle **Valor Total** (divide automaticamente) / **Valor por Parcela**
- Modal de cartão: banco, limite, dia de fechamento, dia de vencimento
- Remoção inline de lançamentos e de cartões

---

### Infraestrutura

- Nginx como reverse proxy (porta 80) e servidor de arquivos estáticos (`dist/frontend/browser`)
- FastAPI rodando via `uvicorn` em `127.0.0.1:8000`, gerenciado por `systemctl` (`elo-api.service`)
- Angular build de produção em `/home/administrador/projeto/frontend/dist/frontend/browser`
- Virtualenv em `/home/administrador/projeto/venv/`

---

## Próximos passos planejados

- [ ] Relatórios: gráficos mensais de receitas vs despesas
- [ ] Dashboard: seção de conquistas com progresso real (substituir placeholder)
- [ ] Notificações: alertas de vencimento próximo
- [ ] Upload de comprovantes (PDF/imagem) com armazenamento local
