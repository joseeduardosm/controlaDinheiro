"""
rotas/cartoes.py — Endpoints de cartões de crédito e lançamentos parcelados.

Prefixo: /api/cartoes
Tag:     Cartões

Fluxo de fatura:
  - Cada lançamento tem data_compra, parcela_inicial e parcela_final.
  - O backend calcula em qual mês/ano cada parcela vence, com base no
    fechamento e vencimento do cartão.
  - Se vencimento > fechamento: vence no mesmo mês do ciclo.
  - Se vencimento <= fechamento: vence no mês seguinte ao ciclo.

Divisão:
  - Mesmo padrão de DespesaDivisao: lançamento tem dividido_email +
    dividido_porcentagem. Parceiro responde via /lancamentos/{id}/responder.
"""

import calendar
from datetime import datetime, date
from typing import Optional

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from banco import obter_sessao
from modelos import Cartao, CartaoLancamento, StatusDivisaoCartao, SituacaoLancamento, Usuario
from rotas.autenticacao import obter_usuario_atual

roteador = APIRouter(prefix="/api/cartoes", tags=["Cartões"])


# ─── Helpers de cálculo de fatura ─────────────────────────────────────────────

def _data_vencimento_parcela(
    data_compra: date,
    fechamento: int,
    vencimento: int,
    offset_parcela: int,
) -> date:
    """
    Calcula a data de vencimento de uma parcela específica.

    offset_parcela=0 → primeira parcela, 1 → segunda, etc.

    Regra:
      - Se data_compra.day <= fechamento: ciclo inicia no mês da compra.
      - Senão: ciclo inicia no mês seguinte.
      - Se vencimento > fechamento: fatura vence no mesmo mês do ciclo.
      - Senão: fatura vence no mês seguinte ao ciclo.
    """
    # Mês inicial do ciclo desta compra
    if data_compra.day <= fechamento:
        mes_ciclo = date(data_compra.year, data_compra.month, 1)
    else:
        mes_ciclo = date(data_compra.year, data_compra.month, 1) + relativedelta(months=1)

    # Avança o número de parcelas
    mes_ciclo += relativedelta(months=offset_parcela)

    # Determina o mês de vencimento
    if vencimento > fechamento:
        mes_venc = mes_ciclo
    else:
        mes_venc = mes_ciclo + relativedelta(months=1)

    # Ajusta o dia (meses curtos)
    ultimo_dia = calendar.monthrange(mes_venc.year, mes_venc.month)[1]
    return date(mes_venc.year, mes_venc.month, min(vencimento, ultimo_dia))


def _parcela_em_mes(
    lancamento: CartaoLancamento,
    cartao: Cartao,
    mes: int,
    ano: int,
) -> tuple[Optional[int], Optional[date]]:
    """
    Retorna (número_da_parcela, data_vencimento) se alguma parcela do
    lançamento vence no mês/ano informado. Caso contrário retorna (None, None).
    """
    for n in range(lancamento.parcela_inicial, lancamento.parcela_final + 1):
        offset = n - lancamento.parcela_inicial
        data_venc = _data_vencimento_parcela(
            lancamento.data_compra, cartao.fechamento, cartao.vencimento, offset
        )
        if data_venc.month == mes and data_venc.year == ano:
            return n, data_venc
    return None, None


# ─── Schemas ──────────────────────────────────────────────────────────────────

class EntradaCartao(BaseModel):
    """Payload para criar ou editar um cartão."""
    banco:      str   = Field(..., min_length=1, max_length=100)
    limite:     float = Field(..., gt=0)
    fechamento: int   = Field(..., ge=1, le=31)
    vencimento: int   = Field(..., ge=1, le=31)


class RespostaCartao(BaseModel):
    """Dados retornados de um cartão."""
    id:         int
    usuario_id: int
    banco:      str
    limite:     float
    fechamento: int
    vencimento: int
    ativo:      bool
    criado_em:  datetime

    model_config = {"from_attributes": True}


class EntradaLancamento(BaseModel):
    """Payload para criar ou editar um lançamento."""
    descricao:             str   = Field(..., min_length=1, max_length=255)
    valor_parcela:         float = Field(..., gt=0)
    parcela_inicial:       int   = Field(default=1, ge=1)
    parcela_final:         int   = Field(..., ge=1)
    data_compra:           date
    situacao:              str   = "pendente"
    dividido_email:        Optional[str]  = None
    dividido_porcentagem:  Optional[float] = Field(default=None, ge=0, le=100)


class RespostaLancamentoFatura(BaseModel):
    """Lançamento enriquecido com dados da parcela do mês solicitado."""
    id:                   int
    cartao_id:            int
    descricao:            str
    valor_parcela:        float
    parcela_atual:        int
    parcela_total:        int
    data_compra:          date
    data_vencimento:      date
    situacao:             str
    dividido_email:       Optional[str]
    dividido_porcentagem: Optional[float]
    divisao_status:       Optional[str]
    criado_em:            datetime

    model_config = {"from_attributes": True}


class RespostaFaturaResumo(BaseModel):
    """Totais da fatura de um mês."""
    total:          float
    pago:           float
    pendente:       float
    quantidade:     int


class EntradaResposta(BaseModel):
    """Payload para aceitar ou negar a divisão de um lançamento."""
    resposta:      str   # "de_acordo" ou "negado"
    justificativa: Optional[str] = None


class RespostaLancamentoPendente(BaseModel):
    """Lançamento aguardando resposta do usuário convidado."""
    lancamento_id:       int
    cartao_banco:        str
    descricao:           str
    valor_parcela:       float
    minha_parte:         float    # valor_parcela × porcentagem/100
    minha_porcentagem:   float
    parcela_atual:       int
    parcela_total:       int
    data_compra:         date
    data_vencimento:     Optional[date]  # pode ser None se fora de qualquer mês específico


# ─── CRUD de Cartões ──────────────────────────────────────────────────────────

@roteador.get("/", response_model=list[RespostaCartao])
def listar_cartoes(
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Lista todos os cartões ativos do usuário autenticado."""
    return (
        sessao.query(Cartao)
        .filter(Cartao.usuario_id == usuario.id, Cartao.ativo == True)
        .order_by(Cartao.criado_em.asc())
        .all()
    )


@roteador.post("/", response_model=RespostaCartao, status_code=status.HTTP_201_CREATED)
def criar_cartao(
    dados: EntradaCartao,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Cria um novo cartão de crédito para o usuário."""
    cartao = Cartao(
        usuario_id=usuario.id,
        banco=dados.banco.strip(),
        limite=dados.limite,
        fechamento=dados.fechamento,
        vencimento=dados.vencimento,
    )
    sessao.add(cartao)
    sessao.commit()
    sessao.refresh(cartao)
    return cartao


@roteador.put("/{cartao_id}", response_model=RespostaCartao)
def editar_cartao(
    cartao_id: int,
    dados: EntradaCartao,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Edita os dados de um cartão do usuário."""
    cartao = sessao.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.usuario_id == usuario.id,
    ).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    cartao.banco      = dados.banco.strip()
    cartao.limite     = dados.limite
    cartao.fechamento = dados.fechamento
    cartao.vencimento = dados.vencimento

    sessao.commit()
    sessao.refresh(cartao)
    return cartao


@roteador.delete("/{cartao_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_cartao(
    cartao_id: int,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Remove permanentemente um cartão e todos os seus lançamentos."""
    cartao = sessao.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.usuario_id == usuario.id,
    ).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    sessao.delete(cartao)
    sessao.commit()


# ─── Lançamentos e Fatura ─────────────────────────────────────────────────────

@roteador.get("/{cartao_id}/fatura", response_model=list[RespostaLancamentoFatura])
def listar_fatura(
    cartao_id: int,
    mes: int,
    ano: int,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """
    Lista os lançamentos do cartão cujas parcelas vencem no mês/ano informado.
    Cada item inclui qual parcela cai naquele mês e a data de vencimento.
    """
    cartao = sessao.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.usuario_id == usuario.id,
    ).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    todos = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.cartao_id == cartao_id
    ).all()

    resultado = []
    for lanc in todos:
        n_parcela, data_venc = _parcela_em_mes(lanc, cartao, mes, ano)
        if n_parcela is None:
            continue

        total_parcelas = lanc.parcela_final - lanc.parcela_inicial + 1

        resultado.append(RespostaLancamentoFatura(
            id=lanc.id,
            cartao_id=lanc.cartao_id,
            descricao=lanc.descricao,
            valor_parcela=float(lanc.valor_parcela),
            parcela_atual=n_parcela,
            parcela_total=total_parcelas,
            data_compra=lanc.data_compra,
            data_vencimento=data_venc,
            situacao=lanc.situacao.value,
            dividido_email=lanc.dividido_email,
            dividido_porcentagem=float(lanc.dividido_porcentagem) if lanc.dividido_porcentagem else None,
            divisao_status=lanc.divisao_status.value if lanc.divisao_status else None,
            criado_em=lanc.criado_em,
        ))

    # Ordena por data de vencimento crescente
    resultado.sort(key=lambda x: x.data_vencimento)
    return resultado


@roteador.get("/{cartao_id}/fatura-resumo", response_model=RespostaFaturaResumo)
def resumo_fatura(
    cartao_id: int,
    mes: int,
    ano: int,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Retorna totais (total, pago, pendente) da fatura do mês."""
    cartao = sessao.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.usuario_id == usuario.id,
    ).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    todos = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.cartao_id == cartao_id
    ).all()

    total = pago = pendente = 0.0
    quantidade = 0

    for lanc in todos:
        n_parcela, _ = _parcela_em_mes(lanc, cartao, mes, ano)
        if n_parcela is None:
            continue

        v = float(lanc.valor_parcela)
        total += v
        quantidade += 1
        if lanc.situacao == SituacaoLancamento.pago:
            pago += v
        else:
            pendente += v

    return RespostaFaturaResumo(total=total, pago=pago, pendente=pendente, quantidade=quantidade)


@roteador.post("/{cartao_id}/lancamentos", response_model=RespostaLancamentoFatura, status_code=status.HTTP_201_CREATED)
def criar_lancamento(
    cartao_id: int,
    dados: EntradaLancamento,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Registra um novo lançamento no cartão."""
    cartao = sessao.query(Cartao).filter(
        Cartao.id == cartao_id,
        Cartao.usuario_id == usuario.id,
    ).first()
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado")

    if dados.parcela_final < dados.parcela_inicial:
        raise HTTPException(status_code=422, detail="parcela_final deve ser >= parcela_inicial")

    # Define status de divisão se houver convidado
    divisao_status = None
    if dados.dividido_email:
        if not dados.dividido_porcentagem:
            raise HTTPException(status_code=422, detail="Informe a porcentagem do parceiro")
        divisao_status = StatusDivisaoCartao.aguardando

    try:
        situacao = SituacaoLancamento(dados.situacao)
    except ValueError:
        raise HTTPException(status_code=422, detail="Situação inválida")

    lanc = CartaoLancamento(
        cartao_id=cartao_id,
        usuario_id=usuario.id,
        descricao=dados.descricao.strip(),
        valor_parcela=dados.valor_parcela,
        parcela_inicial=dados.parcela_inicial,
        parcela_final=dados.parcela_final,
        data_compra=dados.data_compra,
        situacao=situacao,
        dividido_email=dados.dividido_email,
        dividido_porcentagem=dados.dividido_porcentagem,
        divisao_status=divisao_status,
    )
    sessao.add(lanc)
    sessao.commit()
    sessao.refresh(lanc)

    # Retorna enriquecido com dados da primeira parcela como referência
    n, data_venc = _parcela_em_mes(lanc, cartao, dados.data_compra.month, dados.data_compra.year)
    if n is None:
        # Se a compra não cai no próprio mês, calcula a primeira parcela
        data_venc = _data_vencimento_parcela(
            lanc.data_compra, cartao.fechamento, cartao.vencimento, 0
        )
        n = lanc.parcela_inicial

    total_parcelas = lanc.parcela_final - lanc.parcela_inicial + 1

    return RespostaLancamentoFatura(
        id=lanc.id,
        cartao_id=lanc.cartao_id,
        descricao=lanc.descricao,
        valor_parcela=float(lanc.valor_parcela),
        parcela_atual=n,
        parcela_total=total_parcelas,
        data_compra=lanc.data_compra,
        data_vencimento=data_venc,
        situacao=lanc.situacao.value,
        dividido_email=lanc.dividido_email,
        dividido_porcentagem=float(lanc.dividido_porcentagem) if lanc.dividido_porcentagem else None,
        divisao_status=lanc.divisao_status.value if lanc.divisao_status else None,
        criado_em=lanc.criado_em,
    )


@roteador.put("/lancamentos/{lancamento_id}", response_model=RespostaLancamentoFatura)
def editar_lancamento(
    lancamento_id: int,
    dados: EntradaLancamento,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Edita um lançamento existente do usuário."""
    lanc = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.id == lancamento_id,
        CartaoLancamento.usuario_id == usuario.id,
    ).first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")

    if dados.parcela_final < dados.parcela_inicial:
        raise HTTPException(status_code=422, detail="parcela_final deve ser >= parcela_inicial")

    try:
        situacao = SituacaoLancamento(dados.situacao)
    except ValueError:
        raise HTTPException(status_code=422, detail="Situação inválida")

    # Atualiza divisão
    divisao_status = lanc.divisao_status
    if dados.dividido_email:
        if not dados.dividido_porcentagem:
            raise HTTPException(status_code=422, detail="Informe a porcentagem do parceiro")
        if divisao_status is None:
            divisao_status = StatusDivisaoCartao.aguardando
    else:
        divisao_status = None

    lanc.descricao            = dados.descricao.strip()
    lanc.valor_parcela        = dados.valor_parcela
    lanc.parcela_inicial      = dados.parcela_inicial
    lanc.parcela_final        = dados.parcela_final
    lanc.data_compra          = dados.data_compra
    lanc.situacao             = situacao
    lanc.dividido_email       = dados.dividido_email
    lanc.dividido_porcentagem = dados.dividido_porcentagem
    lanc.divisao_status       = divisao_status

    sessao.commit()
    sessao.refresh(lanc)

    cartao = sessao.get(Cartao, lanc.cartao_id)
    n, data_venc = _parcela_em_mes(lanc, cartao, dados.data_compra.month, dados.data_compra.year)
    if n is None:
        data_venc = _data_vencimento_parcela(lanc.data_compra, cartao.fechamento, cartao.vencimento, 0)
        n = lanc.parcela_inicial

    total_parcelas = lanc.parcela_final - lanc.parcela_inicial + 1

    return RespostaLancamentoFatura(
        id=lanc.id,
        cartao_id=lanc.cartao_id,
        descricao=lanc.descricao,
        valor_parcela=float(lanc.valor_parcela),
        parcela_atual=n,
        parcela_total=total_parcelas,
        data_compra=lanc.data_compra,
        data_vencimento=data_venc,
        situacao=lanc.situacao.value,
        dividido_email=lanc.dividido_email,
        dividido_porcentagem=float(lanc.dividido_porcentagem) if lanc.dividido_porcentagem else None,
        divisao_status=lanc.divisao_status.value if lanc.divisao_status else None,
        criado_em=lanc.criado_em,
    )


@roteador.patch("/lancamentos/{lancamento_id}/situacao", response_model=RespostaLancamentoFatura)
def alterar_situacao_lancamento(
    lancamento_id: int,
    dados: dict,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Alterna a situação (pago/pendente) de um lançamento."""
    lanc = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.id == lancamento_id,
        CartaoLancamento.usuario_id == usuario.id,
    ).first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")

    try:
        lanc.situacao = SituacaoLancamento(dados.get("situacao", "pendente"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Situação inválida")

    sessao.commit()
    sessao.refresh(lanc)

    cartao = sessao.get(Cartao, lanc.cartao_id)
    n, data_venc = _parcela_em_mes(lanc, cartao, lanc.data_compra.month, lanc.data_compra.year)
    if n is None:
        data_venc = _data_vencimento_parcela(lanc.data_compra, cartao.fechamento, cartao.vencimento, 0)
        n = lanc.parcela_inicial

    return RespostaLancamentoFatura(
        id=lanc.id,
        cartao_id=lanc.cartao_id,
        descricao=lanc.descricao,
        valor_parcela=float(lanc.valor_parcela),
        parcela_atual=n,
        parcela_total=lanc.parcela_final - lanc.parcela_inicial + 1,
        data_compra=lanc.data_compra,
        data_vencimento=data_venc,
        situacao=lanc.situacao.value,
        dividido_email=lanc.dividido_email,
        dividido_porcentagem=float(lanc.dividido_porcentagem) if lanc.dividido_porcentagem else None,
        divisao_status=lanc.divisao_status.value if lanc.divisao_status else None,
        criado_em=lanc.criado_em,
    )


@roteador.delete("/lancamentos/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_lancamento(
    lancamento_id: int,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """Remove um lançamento permanentemente."""
    lanc = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.id == lancamento_id,
        CartaoLancamento.usuario_id == usuario.id,
    ).first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")

    sessao.delete(lanc)
    sessao.commit()


# ─── Divisão de lançamentos ───────────────────────────────────────────────────

@roteador.get("/lancamentos/pendentes", response_model=list[RespostaLancamentoPendente])
def listar_lancamentos_pendentes(
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """
    Lista lançamentos de outros usuários que aguardam aprovação do usuário logado.
    (dividido_email == email do usuário AND divisao_status == 'aguardando')
    """
    lancamentos = (
        sessao.query(CartaoLancamento)
        .filter(
            CartaoLancamento.dividido_email == usuario.email,
            CartaoLancamento.divisao_status == StatusDivisaoCartao.aguardando,
        )
        .all()
    )

    resultado = []
    hoje = date.today()

    for lanc in lancamentos:
        cartao = sessao.get(Cartao, lanc.cartao_id)
        if not cartao:
            continue

        minha_perc = float(lanc.dividido_porcentagem or 0)
        minha_parte = float(lanc.valor_parcela) * minha_perc / 100.0

        # Tenta encontrar a próxima parcela pendente
        data_venc = None
        for n in range(lanc.parcela_inicial, lanc.parcela_final + 1):
            offset = n - lanc.parcela_inicial
            dv = _data_vencimento_parcela(lanc.data_compra, cartao.fechamento, cartao.vencimento, offset)
            if dv >= hoje:
                data_venc = dv
                break

        total_parcelas = lanc.parcela_final - lanc.parcela_inicial + 1

        resultado.append(RespostaLancamentoPendente(
            lancamento_id=lanc.id,
            cartao_banco=cartao.banco,
            descricao=lanc.descricao,
            valor_parcela=float(lanc.valor_parcela),
            minha_parte=minha_parte,
            minha_porcentagem=minha_perc,
            parcela_atual=lanc.parcela_inicial,
            parcela_total=total_parcelas,
            data_compra=lanc.data_compra,
            data_vencimento=data_venc,
        ))

    return resultado


@roteador.post("/lancamentos/{lancamento_id}/responder", status_code=status.HTTP_200_OK)
def responder_divisao(
    lancamento_id: int,
    dados: EntradaResposta,
    sessao: Session = Depends(obter_sessao),
    usuario: Usuario = Depends(obter_usuario_atual),
):
    """
    Aceita ou nega a divisão de um lançamento.
    Apenas o usuário com e-mail igual a dividido_email pode responder.
    """
    lanc = sessao.query(CartaoLancamento).filter(
        CartaoLancamento.id == lancamento_id,
        CartaoLancamento.dividido_email == usuario.email,
        CartaoLancamento.divisao_status == StatusDivisaoCartao.aguardando,
    ).first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento pendente não encontrado")

    if dados.resposta not in ("de_acordo", "negado"):
        raise HTTPException(status_code=422, detail="Resposta inválida. Use 'de_acordo' ou 'negado'")

    if dados.resposta == "negado" and not dados.justificativa:
        raise HTTPException(status_code=422, detail="Informe a justificativa para negar")

    lanc.divisao_status = StatusDivisaoCartao(dados.resposta)
    if dados.justificativa:
        lanc.justificativa_negacao = dados.justificativa.strip()

    sessao.commit()
    return {"status": "ok", "resposta": dados.resposta}
