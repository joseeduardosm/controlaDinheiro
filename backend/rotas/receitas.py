"""
rotas/receitas.py — Endpoints de CRUD para receitas do usuário.

Todos os endpoints requerem autenticação JWT via Depends(obter_usuario_atual).

Endpoints:
  POST   /api/receitas            — cria receita
  GET    /api/receitas            — lista do mês (com filtros)
  GET    /api/receitas/resumo     — totais do mês (total, recebido, pendente)
  PUT    /api/receitas/{id}       — edita receita
  DELETE /api/receitas/{id}       — remove receita
"""

from datetime import date, timedelta
from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session
from dateutil.relativedelta import relativedelta

from banco import obter_sessao
from modelos import Receita, RecorrenciaTipo, SituacaoReceita, Usuario
from rotas.autenticacao import obter_usuario_atual

# ─── Roteador ────────────────────────────────────────────────────────────────

roteador = APIRouter(prefix="/api/receitas", tags=["Receitas"])

# ─── Schemas Pydantic ────────────────────────────────────────────────────────

class EntradaReceita(BaseModel):
    """Payload para criar ou editar uma receita."""
    descricao:       str
    valor:           float
    data:            date
    recorrente:      RecorrenciaTipo = RecorrenciaTipo.nao
    comprovante_url: Optional[str] = None
    situacao:        SituacaoReceita = SituacaoReceita.pendente

    @field_validator("valor")
    @classmethod
    def valor_positivo(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("O valor deve ser maior que zero")
        return v

    @field_validator("descricao")
    @classmethod
    def descricao_nao_vazia(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("A descrição não pode ser vazia")
        return v.strip()


class RespostaReceita(BaseModel):
    """Dados retornados ao cliente para uma receita."""
    id:              int
    usuario_id:      int
    descricao:       str
    valor:           float
    data:            date
    recorrente:      RecorrenciaTipo
    comprovante_url: Optional[str]
    situacao:        SituacaoReceita
    criado_em:       str

    model_config = {"from_attributes": True}

    @classmethod
    def de_orm(cls, r: Receita) -> "RespostaReceita":
        """Converte o objeto ORM para o schema de resposta."""
        return cls(
            id=r.id,
            usuario_id=r.usuario_id,
            descricao=r.descricao,
            valor=float(r.valor),
            data=r.data,
            recorrente=r.recorrente,
            comprovante_url=r.comprovante_url,
            situacao=r.situacao,
            criado_em=r.criado_em.isoformat(),
        )


class RespostaResumo(BaseModel):
    """Resumo financeiro das receitas do mês."""
    total:     float  # soma de todas as receitas
    recebido:  float  # soma das já recebidas
    pendente:  float  # soma das pendentes
    quantidade: int   # total de registros no mês


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _gerar_datas_recorrencia(data_base: date, recorrente: RecorrenciaTipo, mes: int, ano: int) -> list[date]:
    """
    Dada uma receita recorrente, retorna as datas de ocorrência dentro do mês solicitado.
    Reutiliza a mesma lógica de despesas.
    """
    if recorrente == RecorrenciaTipo.nao:
        # Sem recorrência: retorna a data original se estiver no mês
        if data_base.year == ano and data_base.month == mes:
            return [data_base]
        return []

    # Mapa de incremento por tipo
    incrementos = {
        RecorrenciaTipo.diario:      relativedelta(days=1),
        RecorrenciaTipo.semanal:     relativedelta(weeks=1),
        RecorrenciaTipo.quinzenal:   relativedelta(days=15),
        RecorrenciaTipo.mensal:      relativedelta(months=1),
        RecorrenciaTipo.trimestral:  relativedelta(months=3),
        RecorrenciaTipo.semestral:   relativedelta(months=6),
        RecorrenciaTipo.anual:       relativedelta(years=1),
    }

    delta = incrementos[recorrente]
    inicio_mes = date(ano, mes, 1)
    fim_mes    = inicio_mes + relativedelta(months=1) - timedelta(days=1)

    datas = []
    cursor = data_base

    # Avança até entrar no mês alvo
    while cursor < inicio_mes:
        cursor += delta

    # Coleta todas as ocorrências dentro do mês
    while cursor <= fim_mes:
        datas.append(cursor)
        cursor += delta

    return datas


def _serializar(receita: Receita, data_virtual: date | None = None) -> RespostaReceita:
    """Serializa uma Receita ORM, opcionalmente substituindo a data por uma virtual."""
    r = RespostaReceita.de_orm(receita)
    if data_virtual:
        r.data = data_virtual
    return r


# ─── Endpoints ───────────────────────────────────────────────────────────────

@roteador.post("", status_code=status.HTTP_201_CREATED, response_model=RespostaReceita)
def criar_receita(
    entrada: EntradaReceita,
    db: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Cria uma nova receita para o usuário autenticado."""
    receita = Receita(
        usuario_id=usuario.id,
        descricao=entrada.descricao,
        valor=Decimal(str(entrada.valor)),
        data=entrada.data,
        recorrente=entrada.recorrente,
        comprovante_url=entrada.comprovante_url,
        situacao=entrada.situacao,
    )
    db.add(receita)
    db.commit()
    db.refresh(receita)
    return RespostaReceita.de_orm(receita)


@roteador.get("", response_model=list[RespostaReceita])
def listar_receitas(
    mes:      Optional[int] = Query(None, ge=1, le=12),
    ano:      Optional[int] = Query(None, ge=2000),
    situacao: Optional[SituacaoReceita] = Query(None),
    db:       Session = Depends(obter_sessao),
    usuario:  Usuario = Depends(obter_usuario_atual),
):
    """
    Lista as receitas do usuário com filtros opcionais.
    Para receitas recorrentes, expande as ocorrências dentro do mês.
    """
    # Padrão: mês e ano atuais
    hoje = date.today()
    mes  = mes or hoje.month
    ano  = ano or hoje.year

    # Busca todas as receitas do usuário
    receitas = db.query(Receita).filter(Receita.usuario_id == usuario.id).all()

    resultado = []
    for r in receitas:
        datas = _gerar_datas_recorrencia(r.data, r.recorrente, mes, ano)
        for d in datas:
            # Aplica filtro de situação, se fornecido
            if situacao and r.situacao != situacao:
                continue
            resultado.append(_serializar(r, data_virtual=d if d != r.data else None))

    # Ordena por data decrescente
    resultado.sort(key=lambda x: x.data, reverse=True)
    return resultado


@roteador.get("/resumo", response_model=RespostaResumo)
def resumo_receitas(
    mes:     Optional[int] = Query(None, ge=1, le=12),
    ano:     Optional[int] = Query(None, ge=2000),
    db:      Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Retorna os totais (total, recebido, pendente) do mês solicitado."""
    hoje = date.today()
    mes  = mes or hoje.month
    ano  = ano or hoje.year

    receitas = db.query(Receita).filter(Receita.usuario_id == usuario.id).all()

    total    = 0.0
    recebido = 0.0
    pendente = 0.0
    qtd      = 0

    for r in receitas:
        datas = _gerar_datas_recorrencia(r.data, r.recorrente, mes, ano)
        for _ in datas:
            v = float(r.valor)
            total += v
            qtd   += 1
            if r.situacao == SituacaoReceita.recebido:
                recebido += v
            else:
                pendente += v

    return RespostaResumo(total=total, recebido=recebido, pendente=pendente, quantidade=qtd)


@roteador.put("/{receita_id}", response_model=RespostaReceita)
def editar_receita(
    receita_id: int,
    entrada:    EntradaReceita,
    db:         Session = Depends(obter_sessao),
    usuario:    Usuario = Depends(obter_usuario_atual),
):
    """Edita uma receita existente — apenas o dono pode editar."""
    receita = db.query(Receita).filter(
        Receita.id == receita_id,
        Receita.usuario_id == usuario.id,
    ).first()

    if not receita:
        raise HTTPException(status_code=404, detail="Receita não encontrada")

    receita.descricao       = entrada.descricao
    receita.valor           = Decimal(str(entrada.valor))
    receita.data            = entrada.data
    receita.recorrente      = entrada.recorrente
    receita.comprovante_url = entrada.comprovante_url
    receita.situacao        = entrada.situacao

    db.commit()
    db.refresh(receita)
    return RespostaReceita.de_orm(receita)


@roteador.delete("/{receita_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_receita(
    receita_id: int,
    db:         Session = Depends(obter_sessao),
    usuario:    Usuario = Depends(obter_usuario_atual),
):
    """Remove uma receita — apenas o dono pode remover."""
    receita = db.query(Receita).filter(
        Receita.id == receita_id,
        Receita.usuario_id == usuario.id,
    ).first()

    if not receita:
        raise HTTPException(status_code=404, detail="Receita não encontrada")

    db.delete(receita)
    db.commit()
