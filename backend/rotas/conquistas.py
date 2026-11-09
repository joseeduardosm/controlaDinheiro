"""
rotas/conquistas.py — Endpoints de CRUD para conquistas (metas de poupança).

Endpoints:
  POST   /api/conquistas                       — cria conquista
  GET    /api/conquistas                       — lista conquistas (ativas ou todas)
  PUT    /api/conquistas/{id}                  — edita conquista
  DELETE /api/conquistas/{id}                  — arquiva (soft) ou remove
  POST   /api/conquistas/{id}/aportes          — registra aporte
  GET    /api/conquistas/{id}/aportes          — lista aportes
  DELETE /api/conquistas/{id}/aportes/{aid}    — remove aporte
"""

from datetime import date
from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import func

from banco import obter_sessao
from modelos import Conquista, Aporte, Usuario
from rotas.autenticacao import obter_usuario_atual

# ─── Roteador ────────────────────────────────────────────────────────────────

roteador = APIRouter(prefix="/api/conquistas", tags=["Conquistas"])

# ─── Schemas Pydantic ────────────────────────────────────────────────────────

class EntradaConquista(BaseModel):
    """Payload para criar ou editar uma conquista."""
    nome:      str
    descricao: Optional[str] = None
    meta:      float
    prazo:     date
    emoji:     Optional[str] = None

    @field_validator("meta")
    @classmethod
    def meta_positiva(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("A meta deve ser maior que zero")
        return v

    @field_validator("nome")
    @classmethod
    def nome_nao_vazio(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("O nome não pode ser vazio")
        return v.strip()


class EntradaAporte(BaseModel):
    """Payload para registrar um aporte."""
    valor:     float
    data:      date
    descricao: Optional[str] = None

    @field_validator("valor")
    @classmethod
    def valor_positivo(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("O valor do aporte deve ser maior que zero")
        return v


class RespostaAporte(BaseModel):
    """Dados de um aporte retornados ao cliente."""
    id:          int
    conquista_id: int
    valor:       float
    data:        date
    descricao:   Optional[str]
    criado_em:   str

    model_config = {"from_attributes": True}

    @classmethod
    def de_orm(cls, a: Aporte) -> "RespostaAporte":
        return cls(
            id=a.id,
            conquista_id=a.conquista_id,
            valor=float(a.valor),
            data=a.data,
            descricao=a.descricao,
            criado_em=a.criado_em.isoformat(),
        )


class RespostaConquista(BaseModel):
    """Dados de uma conquista retornados ao cliente."""
    id:         int
    usuario_id: int
    nome:       str
    descricao:  Optional[str]
    meta:       float
    acumulado:  float          # soma dos aportes — calculado no momento
    prazo:      date
    emoji:      Optional[str]
    ativo:      bool
    criado_em:  str
    aportes:    list[RespostaAporte] = []

    model_config = {"from_attributes": True}

    @classmethod
    def de_orm(cls, c: Conquista, incluir_aportes: bool = False) -> "RespostaConquista":
        acumulado = sum(float(a.valor) for a in c.aportes)
        return cls(
            id=c.id,
            usuario_id=c.usuario_id,
            nome=c.nome,
            descricao=c.descricao,
            meta=float(c.meta),
            acumulado=acumulado,
            prazo=c.prazo,
            emoji=c.emoji,
            ativo=c.ativo,
            criado_em=c.criado_em.isoformat(),
            aportes=[RespostaAporte.de_orm(a) for a in c.aportes] if incluir_aportes else [],
        )


# ─── Endpoints: Conquistas ────────────────────────────────────────────────────

@roteador.post("", status_code=status.HTTP_201_CREATED, response_model=RespostaConquista)
def criar_conquista(
    entrada: EntradaConquista,
    db:      Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Cria uma nova meta de poupança."""
    conquista = Conquista(
        usuario_id=usuario.id,
        nome=entrada.nome,
        descricao=entrada.descricao,
        meta=Decimal(str(entrada.meta)),
        prazo=entrada.prazo,
        emoji=entrada.emoji,
    )
    db.add(conquista)
    db.commit()
    db.refresh(conquista)
    return RespostaConquista.de_orm(conquista)


@roteador.get("", response_model=list[RespostaConquista])
def listar_conquistas(
    apenas_ativas: bool = Query(True),
    db:            Session = Depends(obter_sessao),
    usuario:       Usuario = Depends(obter_usuario_atual),
):
    """Lista conquistas do usuário, com aportes incluídos."""
    query = db.query(Conquista).filter(Conquista.usuario_id == usuario.id)
    if apenas_ativas:
        query = query.filter(Conquista.ativo == True)
    conquistas = query.order_by(Conquista.prazo.asc()).all()
    return [RespostaConquista.de_orm(c, incluir_aportes=True) for c in conquistas]


@roteador.put("/{conquista_id}", response_model=RespostaConquista)
def editar_conquista(
    conquista_id: int,
    entrada:      EntradaConquista,
    db:           Session = Depends(obter_sessao),
    usuario:      Usuario = Depends(obter_usuario_atual),
):
    """Edita uma conquista existente."""
    c = db.query(Conquista).filter(
        Conquista.id == conquista_id, Conquista.usuario_id == usuario.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Conquista não encontrada")

    c.nome      = entrada.nome
    c.descricao = entrada.descricao
    c.meta      = Decimal(str(entrada.meta))
    c.prazo     = entrada.prazo
    c.emoji     = entrada.emoji
    db.commit()
    db.refresh(c)
    return RespostaConquista.de_orm(c, incluir_aportes=True)


@roteador.patch("/{conquista_id}/arquivar", response_model=RespostaConquista)
def arquivar_conquista(
    conquista_id: int,
    db:           Session = Depends(obter_sessao),
    usuario:      Usuario = Depends(obter_usuario_atual),
):
    """Arquiva (desativa) uma conquista sem excluí-la."""
    c = db.query(Conquista).filter(
        Conquista.id == conquista_id, Conquista.usuario_id == usuario.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Conquista não encontrada")
    c.ativo = False
    db.commit()
    db.refresh(c)
    return RespostaConquista.de_orm(c)


@roteador.delete("/{conquista_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_conquista(
    conquista_id: int,
    db:           Session = Depends(obter_sessao),
    usuario:      Usuario = Depends(obter_usuario_atual),
):
    """Remove permanentemente a conquista e todos os seus aportes."""
    c = db.query(Conquista).filter(
        Conquista.id == conquista_id, Conquista.usuario_id == usuario.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Conquista não encontrada")
    db.delete(c)
    db.commit()


# ─── Endpoints: Aportes ───────────────────────────────────────────────────────

@roteador.post("/{conquista_id}/aportes", status_code=status.HTTP_201_CREATED, response_model=RespostaConquista)
def registrar_aporte(
    conquista_id: int,
    entrada:      EntradaAporte,
    db:           Session = Depends(obter_sessao),
    usuario:      Usuario = Depends(obter_usuario_atual),
):
    """Registra um aporte e retorna a conquista atualizada com o novo acumulado."""
    c = db.query(Conquista).filter(
        Conquista.id == conquista_id, Conquista.usuario_id == usuario.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Conquista não encontrada")

    aporte = Aporte(
        conquista_id=conquista_id,
        valor=Decimal(str(entrada.valor)),
        data=entrada.data,
        descricao=entrada.descricao,
    )
    db.add(aporte)
    db.commit()
    db.refresh(c)
    return RespostaConquista.de_orm(c, incluir_aportes=True)


@roteador.delete("/{conquista_id}/aportes/{aporte_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_aporte(
    conquista_id: int,
    aporte_id:    int,
    db:           Session = Depends(obter_sessao),
    usuario:      Usuario = Depends(obter_usuario_atual),
):
    """Remove um aporte específico."""
    # Verifica que a conquista pertence ao usuário
    c = db.query(Conquista).filter(
        Conquista.id == conquista_id, Conquista.usuario_id == usuario.id
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Conquista não encontrada")

    a = db.query(Aporte).filter(
        Aporte.id == aporte_id, Aporte.conquista_id == conquista_id
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Aporte não encontrado")

    db.delete(a)
    db.commit()
