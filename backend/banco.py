"""
banco.py — Configuração do SQLAlchemy e sessão do banco de dados.

Exporta:
  - Motor        : engine do SQLAlchemy (conexão com o PostgreSQL)
  - Base         : classe base para todos os modelos ORM
  - obter_sessao : gerador de sessão para usar como dependência do FastAPI
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from configuracao import configuracao


# Motor de conexão com o PostgreSQL
# pool_pre_ping=True verifica a conexão antes de usar (evita "connection reset")
Motor = create_engine(
    configuracao.database_url,
    pool_pre_ping=True,
    echo=(configuracao.ambiente == "desenvolvimento"),  # loga SQL em dev
)

# Fábrica de sessões — cada requisição HTTP abre e fecha a sua própria
FabricaSessao = sessionmaker(autocommit=False, autoflush=False, bind=Motor)


class Base(DeclarativeBase):
    """Classe base para todos os modelos ORM do projeto."""
    pass


def obter_sessao():
    """
    Dependência do FastAPI: abre uma sessão do banco para cada requisição
    e garante que ela seja fechada ao final, mesmo em caso de erro.

    Uso:
        @app.get("/rota")
        def minha_rota(sessao: Session = Depends(obter_sessao)):
            ...
    """
    sessao = FabricaSessao()
    try:
        yield sessao
    finally:
        sessao.close()
