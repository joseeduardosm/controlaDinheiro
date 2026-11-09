"""
rotas/dashboard.py — Endpoint agregado para o dashboard principal.

Consolida receitas, despesas e balanço do casal em uma única chamada,
evitando múltiplas requisições paralelas do frontend.

Endpoint:
  GET /api/dashboard/resumo?mes=&ano=
"""

from datetime import date, timedelta
from typing import Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from dateutil.relativedelta import relativedelta

from banco import obter_sessao
from modelos import (
    Receita, Despesa, DespesaDivisao,
    RecorrenciaTipo, SituacaoReceita, SituacaoDespesa, StatusDivisao,
    Usuario,
)
from rotas.autenticacao import obter_usuario_atual

# ─── Roteador ────────────────────────────────────────────────────────────────

roteador = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

# ─── Schemas de resposta ─────────────────────────────────────────────────────

class ResumoReceitas(BaseModel):
    """Totais das receitas do mês."""
    total:    float
    recebido: float
    pendente: float
    quantidade: int


class ResumoDespesas(BaseModel):
    """Totais das despesas do mês."""
    total:          float
    pago:           float
    pendente:       float
    quantidade:     int
    compartilhadas: float  # soma das partes compartilhadas (aprovadas)


class BalancoParceiro(BaseModel):
    """Saldo líquido com um parceiro."""
    parceiro_email: str
    parceiro_nome:  Optional[str]
    saldo:          float   # positivo = parceiro te deve; negativo = você deve


class ResumoDashboard(BaseModel):
    """Resposta completa do dashboard."""
    mes:          int
    ano:          int
    receitas:     ResumoReceitas
    despesas:     ResumoDespesas
    saldo:        float          # receitas.total − despesas.total
    balanco_casal: list[BalancoParceiro]


# ─── Helpers (mesmos das outras rotas) ───────────────────────────────────────

def _ocorrencias_no_mes(data_base: date, recorrente: RecorrenciaTipo, mes: int, ano: int) -> int:
    """Retorna quantas vezes o registro cai no mês especificado."""
    if recorrente == RecorrenciaTipo.nao:
        return 1 if (data_base.year == ano and data_base.month == mes) else 0

    incrementos = {
        RecorrenciaTipo.diario:     relativedelta(days=1),
        RecorrenciaTipo.semanal:    relativedelta(weeks=1),
        RecorrenciaTipo.quinzenal:  relativedelta(days=15),
        RecorrenciaTipo.mensal:     relativedelta(months=1),
        RecorrenciaTipo.trimestral: relativedelta(months=3),
        RecorrenciaTipo.semestral:  relativedelta(months=6),
        RecorrenciaTipo.anual:      relativedelta(years=1),
    }

    delta      = incrementos[recorrente]
    inicio_mes = date(ano, mes, 1)
    fim_mes    = inicio_mes + relativedelta(months=1) - timedelta(days=1)
    cursor     = data_base
    count      = 0

    while cursor < inicio_mes:
        cursor += delta

    while cursor <= fim_mes:
        count += 1
        cursor += delta

    return count


# ─── Endpoint ────────────────────────────────────────────────────────────────

@roteador.get("/resumo", response_model=ResumoDashboard)
def resumo_dashboard(
    mes:     Optional[int] = Query(None, ge=1, le=12),
    ano:     Optional[int] = Query(None, ge=2000),
    db:      Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """
    Agrega receitas, despesas e balanço do casal em uma única resposta.
    Padrão do mês/ano: mês e ano atuais se não fornecidos.
    """
    hoje = date.today()
    mes  = mes or hoje.month
    ano  = ano or hoje.year

    # ── Receitas ──────────────────────────────────────────────────────────────

    all_receitas = db.query(Receita).filter(Receita.usuario_id == usuario.id).all()

    r_total    = 0.0
    r_recebido = 0.0
    r_pendente = 0.0
    r_qtd      = 0

    for r in all_receitas:
        n = _ocorrencias_no_mes(r.data, r.recorrente, mes, ano)
        v = float(r.valor) * n
        r_total += v
        r_qtd   += n
        if r.situacao == SituacaoReceita.recebido:
            r_recebido += v
        else:
            r_pendente += v

    # ── Despesas ──────────────────────────────────────────────────────────────

    all_despesas = db.query(Despesa).filter(Despesa.usuario_id == usuario.id).all()

    d_total          = 0.0
    d_pago           = 0.0
    d_pendente       = 0.0
    d_qtd            = 0
    d_compartilhadas = 0.0  # parte do parceiro nas minhas despesas (aprovada)

    for d in all_despesas:
        n = _ocorrencias_no_mes(d.data, d.recorrente, mes, ano)
        v = float(d.valor) * n
        d_total += v
        d_qtd   += n
        if d.situacao == SituacaoDespesa.pago:
            d_pago    += v
        else:
            d_pendente += v

        # Soma a parte do parceiro que já foi aprovada
        if d.divisao and d.divisao.status == StatusDivisao.de_acordo:
            d_compartilhadas += float(d.valor) * float(d.divisao.porcentagem) / 100 * n

    # ── Balanço do casal ──────────────────────────────────────────────────────

    # Busca todos os emails com quem o usuário tem divisões (como criador)
    divisoes_criador = (
        db.query(DespesaDivisao)
        .join(Despesa, DespesaDivisao.despesa_id == Despesa.id)
        .filter(Despesa.usuario_id == usuario.id)
        .all()
    )

    # Busca todas as divisões onde o usuário é convidado (email)
    divisoes_convidado = (
        db.query(DespesaDivisao)
        .filter(DespesaDivisao.email_convidado == usuario.email)
        .filter(DespesaDivisao.status == StatusDivisao.de_acordo)
        .all()
    )

    # Coleta todos os parceiros únicos
    parceiros_emails: set[str] = set()
    for div in divisoes_criador:
        parceiros_emails.add(div.email_convidado)
    for div in divisoes_convidado:
        d = db.query(Despesa).filter(Despesa.id == div.despesa_id).first()
        if d:
            dono = db.query(Usuario).filter(Usuario.id == d.usuario_id).first()
            if dono:
                parceiros_emails.add(dono.email)

    # Calcula saldo por parceiro
    balanco: list[BalancoParceiro] = []

    for email_parceiro in parceiros_emails:
        # Quanto o parceiro deve a mim (minhas despesas com divisão aprovada pelo parceiro)
        total_parceiro_me_deve = 0.0
        for div in divisoes_criador:
            if div.email_convidado != email_parceiro:
                continue
            if div.status != StatusDivisao.de_acordo:
                continue
            d = db.query(Despesa).filter(Despesa.id == div.despesa_id).first()
            if not d:
                continue
            n = _ocorrencias_no_mes(d.data, d.recorrente, mes, ano)
            total_parceiro_me_deve += float(d.valor) * float(div.porcentagem) / 100 * n

        # Quanto eu devo ao parceiro (despesas dele com minha divisão aprovada)
        total_eu_devo_parceiro = 0.0
        for div in divisoes_convidado:
            d = db.query(Despesa).filter(Despesa.id == div.despesa_id).first()
            if not d:
                continue
            dono = db.query(Usuario).filter(Usuario.id == d.usuario_id).first()
            if not dono or dono.email != email_parceiro:
                continue
            n = _ocorrencias_no_mes(d.data, d.recorrente, mes, ano)
            total_eu_devo_parceiro += float(d.valor) * float(div.porcentagem) / 100 * n

        saldo_parceiro = total_parceiro_me_deve - total_eu_devo_parceiro

        # Busca nome do parceiro
        parceiro_usuario = db.query(Usuario).filter(Usuario.email == email_parceiro).first()

        balanco.append(BalancoParceiro(
            parceiro_email=email_parceiro,
            parceiro_nome=parceiro_usuario.nome if parceiro_usuario else None,
            saldo=saldo_parceiro,
        ))

    return ResumoDashboard(
        mes=mes,
        ano=ano,
        receitas=ResumoReceitas(
            total=r_total, recebido=r_recebido,
            pendente=r_pendente, quantidade=r_qtd,
        ),
        despesas=ResumoDespesas(
            total=d_total, pago=d_pago,
            pendente=d_pendente, quantidade=d_qtd,
            compartilhadas=d_compartilhadas,
        ),
        saldo=r_total - d_total,
        balanco_casal=balanco,
    )
