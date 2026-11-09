"""
main.py — Ponto de entrada da API do elo.

Inicializa o app FastAPI, configura CORS, cria as tabelas
no banco (caso não existam) e registra todos os roteadores.

Executado pelo systemctl via:
  uvicorn main:app --host 127.0.0.1 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from banco import Motor, Base
from rotas import autenticacao, despesas, receitas, dashboard, conquistas, cartoes

# ─── Criação das tabelas no banco ─────────────────────────────────────────────
# Em produção futura substituir por Alembic migrations.
# Por ora, cria as tabelas automaticamente ao subir o servidor.
Base.metadata.create_all(bind=Motor)

# ─── App FastAPI ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="elo. API",
    description="Backend do controle financeiro pessoal e em casal",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Em produção: substituir allow_origins=["*"] pelo domínio real.

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Roteadores ───────────────────────────────────────────────────────────────

app.include_router(autenticacao.roteador)
app.include_router(despesas.roteador)
app.include_router(receitas.roteador)
app.include_router(dashboard.roteador)
app.include_router(conquistas.roteador)
app.include_router(cartoes.roteador)

# ─── Health check ─────────────────────────────────────────────────────────────

@app.get("/api/saude", tags=["Sistema"])
def verificar_saude():
    """Confirma que a API está no ar. Usado pelo Nginx e monitoramento."""
    return {"status": "online", "servico": "elo-api"}
