"""
rotas/autenticacao.py — Endpoints de autenticação do elo.

Rotas disponíveis:
  POST /api/auth/cadastrar  — cria uma nova conta de usuário
  POST /api/auth/entrar     — autentica e retorna um token JWT
  GET  /api/auth/eu         — retorna o perfil do usuário autenticado
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, field_validator

from banco import obter_sessao
from modelos import Usuario
from seguranca import gerar_hash_senha, verificar_senha, criar_token_acesso, decodificar_token
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials


# ─── Roteador ──────────────────────────────────────────────────────────────────

roteador = APIRouter(prefix="/api/auth", tags=["Autenticação"])

# Esquema de autenticação via Bearer Token (JWT no header Authorization)
esquema_bearer = HTTPBearer()


# ─── Schemas Pydantic (validação de entrada e saída) ──────────────────────────

class EntradaCadastro(BaseModel):
    """Dados recebidos no corpo da requisição de cadastro."""
    nome: str
    email: EmailStr
    senha: str

    @field_validator("nome")
    @classmethod
    def validar_nome(cls, valor: str) -> str:
        valor = valor.strip()
        if len(valor) < 2:
            raise ValueError("Nome deve ter no mínimo 2 caracteres")
        return valor

    @field_validator("senha")
    @classmethod
    def validar_senha(cls, valor: str) -> str:
        if len(valor) < 4:
            raise ValueError("Senha deve ter no mínimo 4 caracteres")
        return valor


class EntradaLogin(BaseModel):
    """Dados recebidos no corpo da requisição de login."""
    email: EmailStr
    senha: str


class RespostaToken(BaseModel):
    """Resposta retornada após login ou cadastro bem-sucedido."""
    token_acesso: str
    tipo_token: str = "bearer"
    usuario: "RespostaUsuario"


class RespostaUsuario(BaseModel):
    """Dados públicos do usuário (nunca expor senha_hash)."""
    id: int
    nome: str
    email: str

    model_config = {"from_attributes": True}  # permite criar a partir de ORM


# Atualiza referência forward no RespostaToken
RespostaToken.model_rebuild()


# ─── Dependência: usuário autenticado ─────────────────────────────────────────

def obter_usuario_atual(
    credenciais: HTTPAuthorizationCredentials = Depends(esquema_bearer),
    sessao: Session = Depends(obter_sessao),
) -> Usuario:
    """
    Dependência reutilizável: valida o token JWT e retorna o usuário do banco.
    Usado em rotas protegidas com: usuario = Depends(obter_usuario_atual)
    """
    payload = decodificar_token(credenciais.credentials)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email: str = payload.get("sub")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token malformado")

    usuario = sessao.query(Usuario).filter(Usuario.email == email).first()
    if not usuario or not usuario.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário não encontrado")

    return usuario


# ─── Endpoints ────────────────────────────────────────────────────────────────

@roteador.post(
    "/cadastrar",
    response_model=RespostaToken,
    status_code=status.HTTP_201_CREATED,
    summary="Criar nova conta",
)
def cadastrar(entrada: EntradaCadastro, sessao: Session = Depends(obter_sessao)):
    """
    Cria uma nova conta de usuário.

    Regras:
      - E-mail deve ser único
      - Senha mínima de 4 caracteres (validada no schema)
      - Senha é armazenada como hash bcrypt, nunca em texto puro
    """
    # Verifica se já existe uma conta com este e-mail
    email_em_uso = sessao.query(Usuario).filter(Usuario.email == entrada.email).first()
    if email_em_uso:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este e-mail já está cadastrado",
        )

    # Cria o usuário com a senha em hash
    novo_usuario = Usuario(
        nome=entrada.nome,
        email=entrada.email,
        senha_hash=gerar_hash_senha(entrada.senha),
    )
    sessao.add(novo_usuario)
    sessao.commit()
    sessao.refresh(novo_usuario)

    # Gera e retorna o token já no cadastro (login automático)
    token = criar_token_acesso({"sub": novo_usuario.email})

    return RespostaToken(
        token_acesso=token,
        usuario=RespostaUsuario.model_validate(novo_usuario),
    )


@roteador.post(
    "/entrar",
    response_model=RespostaToken,
    summary="Entrar na conta",
)
def entrar(entrada: EntradaLogin, sessao: Session = Depends(obter_sessao)):
    """
    Autentica o usuário com e-mail e senha.

    Em caso de sucesso retorna um token JWT de acesso.
    A mensagem de erro é genérica (não revela se o e-mail existe)
    para evitar enumeração de usuários.
    """
    # Busca o usuário pelo e-mail
    usuario = sessao.query(Usuario).filter(Usuario.email == entrada.email).first()

    # Mensagem genérica para não revelar qual campo está errado
    erro_credenciais = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="E-mail ou senha incorretos",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not usuario or not usuario.ativo:
        raise erro_credenciais

    if not verificar_senha(entrada.senha, usuario.senha_hash):
        raise erro_credenciais

    token = criar_token_acesso({"sub": usuario.email})

    return RespostaToken(
        token_acesso=token,
        usuario=RespostaUsuario.model_validate(usuario),
    )


@roteador.get(
    "/eu",
    response_model=RespostaUsuario,
    summary="Perfil do usuário autenticado",
)
def perfil_atual(usuario: Usuario = Depends(obter_usuario_atual)):
    """
    Rota protegida — retorna os dados do usuário dono do token.
    Usada pelo Angular para validar a sessão ao recarregar o app.
    """
    return RespostaUsuario.model_validate(usuario)
