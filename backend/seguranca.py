"""
seguranca.py — Utilitários de autenticação: hash de senha e JWT.

Responsabilidades:
  - Gerar e verificar hash bcrypt das senhas
  - Criar tokens JWT de acesso
  - Decodificar e validar tokens JWT recebidos nas requisições
"""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from configuracao import configuracao


# Contexto de hashing — usa bcrypt, o algoritmo recomendado para senhas
contexto_senha = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ─── Funções de senha ──────────────────────────────────────────────────────────

def gerar_hash_senha(senha: str) -> str:
    """
    Gera o hash bcrypt de uma senha em texto puro.
    Chamado ao criar ou redefinir a senha do usuário.
    """
    return contexto_senha.hash(senha)


def verificar_senha(senha_pura: str, senha_hash: str) -> bool:
    """
    Compara a senha informada no login com o hash armazenado no banco.
    Retorna True se coincidirem, False caso contrário.
    """
    return contexto_senha.verify(senha_pura, senha_hash)


# ─── Funções de JWT ────────────────────────────────────────────────────────────

def criar_token_acesso(dados: dict) -> str:
    """
    Cria um token JWT assinado com o segredo da aplicação.

    O token carrega os dados fornecidos mais um campo 'exp' (expiração).
    O frontend deve enviar este token no header:
        Authorization: Bearer <token>

    Args:
        dados: dicionário com os dados a incluir no payload (ex.: {"sub": email})

    Returns:
        string com o token JWT assinado
    """
    payload = dados.copy()

    # Define a data/hora de expiração em UTC
    expiracao = datetime.now(timezone.utc) + timedelta(
        minutes=configuracao.jwt_expiracao_minutos
    )
    payload["exp"] = expiracao

    return jwt.encode(payload, configuracao.jwt_segredo, algorithm="HS256")


def decodificar_token(token: str) -> dict | None:
    """
    Decodifica e valida um token JWT.

    Retorna o payload como dict se o token for válido e não expirado.
    Retorna None se o token for inválido, expirado ou adulterado.
    """
    try:
        payload = jwt.decode(token, configuracao.jwt_segredo, algorithms=["HS256"])
        return payload
    except JWTError:
        return None
