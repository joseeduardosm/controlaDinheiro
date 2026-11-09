"""
configuracao.py — Carrega variáveis de ambiente via pydantic-settings.

Todas as configs sensíveis (banco, JWT) vêm do arquivo .env,
nunca hardcoded no código-fonte.
"""

from pydantic_settings import BaseSettings


class Configuracao(BaseSettings):
    """Mapeamento das variáveis de ambiente para atributos tipados."""

    # Banco de dados
    database_url: str

    # JWT
    jwt_segredo: str
    jwt_expiracao_minutos: int = 60

    # Ambiente
    ambiente: str = "desenvolvimento"

    class Config:
        # Lê automaticamente do arquivo .env na pasta atual
        env_file = ".env"
        env_file_encoding = "utf-8"


# Instância global — importada pelos módulos que precisam de config
configuracao = Configuracao()
