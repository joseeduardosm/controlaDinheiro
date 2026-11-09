"""
rotas/despesas.py — Endpoints de despesas e divisão entre usuários.

Prefixo: /api/despesas
Autenticação: todas as rotas requerem token JWT (Bearer).

Endpoints:
  POST   /api/despesas                        — Criar despesa (+ divisão opcional)
  GET    /api/despesas                        — Listar despesas do usuário
  PUT    /api/despesas/{id}                   — Editar despesa
  DELETE /api/despesas/{id}                   — Remover despesa
  GET    /api/despesas/pendentes              — Divisões aguardando aprovação do usuário
  POST   /api/despesas/divisoes/{id}/responder — Aceitar ou negar divisão
  GET    /api/despesas/balanco                — Balanço mensal com parceiros
"""

from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional, List
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, extract

from banco import obter_sessao
from modelos import (
    Usuario, Despesa, DespesaDivisao,
    RecorrenciaTipo, SituacaoDespesa, StatusDivisao,
)
from rotas.autenticacao import obter_usuario_atual

# ─── Roteador ────────────────────────────────────────────────────────────────

roteador = APIRouter(prefix="/api/despesas", tags=["Despesas"])

# ─── Schemas Pydantic ────────────────────────────────────────────────────────

class EntradaDivisao(BaseModel):
    """Dados da divisão ao criar uma despesa compartilhada."""
    email_convidado: EmailStr
    porcentagem: Decimal          # 0.01 a 100.00 — parte do convidado

    @field_validator("porcentagem")
    @classmethod
    def validar_porcentagem(cls, v: Decimal) -> Decimal:
        if not (Decimal("0.01") <= v <= Decimal("100.00")):
            raise ValueError("Porcentagem deve estar entre 0.01 e 100.00")
        return v


class EntradaDespesa(BaseModel):
    """Payload para criar ou editar uma despesa."""
    descricao: str
    valor: Decimal
    data: date
    recorrente: RecorrenciaTipo = RecorrenciaTipo.nao
    comprovante_url: Optional[str] = None
    situacao: SituacaoDespesa = SituacaoDespesa.pendente
    divisao: Optional[EntradaDivisao] = None   # opcional — se presente, compartilha

    @field_validator("valor")
    @classmethod
    def validar_valor(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Valor deve ser maior que zero")
        return v


class RespostaDivisao(BaseModel):
    """Dados da divisão na resposta da API."""
    id: int
    email_convidado: str
    porcentagem: Decimal
    status: StatusDivisao
    justificativa_negacao: Optional[str] = None
    confirmado_em: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RespostaDespesa(BaseModel):
    """Dados de uma despesa na resposta da API."""
    id: int
    usuario_id: int
    descricao: str
    valor: Decimal
    data: date
    recorrente: RecorrenciaTipo
    comprovante_url: Optional[str] = None
    situacao: SituacaoDespesa
    divisao: Optional[RespostaDivisao] = None
    criado_em: datetime

    model_config = {"from_attributes": True}


class RespostaDespesaPendente(BaseModel):
    """
    Despesa aguardando aprovação do usuário convidado.
    Inclui minha_parte já calculada (valor × porcentagem / 100).
    """
    divisao_id: int
    despesa: RespostaDespesa
    minha_parte: Decimal           # valor que será debitado do meu fluxo
    nome_criador: Optional[str]    # nome de quem criou a despesa


class EntradaResposta(BaseModel):
    """Payload para aceitar ou negar uma divisão."""
    resposta: StatusDivisao        # "de_acordo" ou "negado"
    justificativa: Optional[str] = None

    @field_validator("justificativa")
    @classmethod
    def validar_justificativa(cls, v: Optional[str], info) -> Optional[str]:
        # Justificativa é obrigatória ao negar
        # (acessamos o campo resposta via info.data após validação parcial)
        return v


class RespostaBalanco(BaseModel):
    """Saldo líquido com um parceiro no mês."""
    parceiro_email: str
    parceiro_nome: Optional[str]
    saldo: Decimal     # positivo = parceiro me deve; negativo = eu devo ao parceiro
    total_eu_lancei: Decimal    # soma da parte do parceiro em despesas que eu criei
    total_ele_lancou: Decimal   # soma da minha parte em despesas que o parceiro criou


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _verificar_dono(despesa: Despesa, usuario: Usuario) -> None:
    """Lança 403 se o usuário não for o dono da despesa."""
    if despesa.usuario_id != usuario.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você não tem permissão para modificar esta despesa",
        )


def _gerar_datas_recorrencia(data_base: date, recorrente: RecorrenciaTipo, mes: int, ano: int) -> List[date]:
    """
    Gera as datas de ocorrência de uma despesa recorrente dentro de um mês/ano.
    Retorna lista de datas (pode ser vazia ou ter múltiplas datas para recorrências diárias).
    """
    if recorrente == RecorrenciaTipo.nao:
        # Não recorrente: retorna só se a data cai no mês solicitado
        if data_base.month == mes and data_base.year == ano:
            return [data_base]
        return []

    # Mapa de incremento por tipo de recorrência
    incrementos = {
        RecorrenciaTipo.diario:      timedelta(days=1),
        RecorrenciaTipo.semanal:     timedelta(weeks=1),
        RecorrenciaTipo.quinzenal:   timedelta(days=15),
        RecorrenciaTipo.mensal:      relativedelta(months=1),
        RecorrenciaTipo.trimestral:  relativedelta(months=3),
        RecorrenciaTipo.semestral:   relativedelta(months=6),
        RecorrenciaTipo.anual:       relativedelta(years=1),
    }

    incremento = incrementos[recorrente]
    datas = []
    inicio_mes = date(ano, mes, 1)
    # Fim do mês solicitado
    fim_mes = (inicio_mes + relativedelta(months=1)) - timedelta(days=1)

    # Percorre a partir da data_base até o final do mês
    data_atual = data_base
    # Avança até o mês solicitado se a data_base for anterior
    while data_atual < inicio_mes:
        data_atual = data_atual + incremento

    while data_atual <= fim_mes:
        if data_atual.month == mes and data_atual.year == ano:
            datas.append(data_atual)
        data_atual = data_atual + incremento

    return datas


# ─── Endpoints ───────────────────────────────────────────────────────────────

@roteador.post("", status_code=status.HTTP_201_CREATED, response_model=RespostaDespesa)
def criar_despesa(
    dados: EntradaDespesa,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """
    Cria uma nova despesa para o usuário autenticado.
    Se `divisao` for informado, cria também a divisão com o usuário convidado.
    A divisão inicia com status "aguardando" — o convidado precisa aprovar ao logar.
    """
    # Cria a despesa principal
    despesa = Despesa(
        usuario_id=usuario.id,
        descricao=dados.descricao,
        valor=dados.valor,
        data=dados.data,
        recorrente=dados.recorrente,
        comprovante_url=dados.comprovante_url,
        situacao=dados.situacao,
    )
    sessao.add(despesa)
    sessao.flush()  # gera o ID da despesa antes de criar a divisão

    # Se houver divisão, cria o registro de compartilhamento
    if dados.divisao:
        # Verifica que o criador não está tentando compartilhar com si mesmo
        if dados.divisao.email_convidado.lower() == usuario.email.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Você não pode dividir uma despesa com você mesmo",
            )

        divisao = DespesaDivisao(
            despesa_id=despesa.id,
            email_convidado=dados.divisao.email_convidado.lower(),
            porcentagem=dados.divisao.porcentagem,
            status=StatusDivisao.aguardando,
        )
        sessao.add(divisao)

    sessao.commit()
    sessao.refresh(despesa)
    return despesa


@roteador.get("", response_model=List[RespostaDespesa])
def listar_despesas(
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    situacao: Optional[SituacaoDespesa] = None,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """
    Lista as despesas do usuário autenticado.
    Filtros opcionais: mes, ano, situacao.
    Para despesas recorrentes, filtra pela data de início (a geração de ocorrências
    futuras é feita na rota de balanço).
    """
    consulta = sessao.query(Despesa).filter(Despesa.usuario_id == usuario.id)

    if mes and ano:
        # Para recorrentes, retorna a despesa base se ela iniciou até o mês solicitado
        # A filtragem de ocorrências é responsabilidade do frontend/balanço
        consulta = consulta.filter(
            or_(
                # Não recorrentes: data cai no mês
                and_(
                    Despesa.recorrente == RecorrenciaTipo.nao,
                    extract("month", Despesa.data) == mes,
                    extract("year", Despesa.data) == ano,
                ),
                # Recorrentes: iniciaram antes ou no mês solicitado
                and_(
                    Despesa.recorrente != RecorrenciaTipo.nao,
                    Despesa.data <= date(ano, mes, 28),  # conservador
                ),
            )
        )
    elif mes:
        consulta = consulta.filter(extract("month", Despesa.data) == mes)
    elif ano:
        consulta = consulta.filter(extract("year", Despesa.data) == ano)

    if situacao:
        consulta = consulta.filter(Despesa.situacao == situacao)

    return consulta.order_by(Despesa.data.desc()).all()


@roteador.put("/{id}", response_model=RespostaDespesa)
def editar_despesa(
    id: int,
    dados: EntradaDespesa,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """Edita uma despesa existente. Apenas o dono pode editar."""
    despesa = sessao.get(Despesa, id)
    if not despesa:
        raise HTTPException(status_code=404, detail="Despesa não encontrada")

    _verificar_dono(despesa, usuario)

    # Atualiza os campos
    despesa.descricao = dados.descricao
    despesa.valor = dados.valor
    despesa.data = dados.data
    despesa.recorrente = dados.recorrente
    despesa.comprovante_url = dados.comprovante_url
    despesa.situacao = dados.situacao

    # Atualiza ou cria divisão
    if dados.divisao:
        if despesa.divisao:
            # Atualiza divisão existente (só se ainda aguardando)
            if despesa.divisao.status != StatusDivisao.aguardando:
                raise HTTPException(
                    status_code=400,
                    detail="Não é possível alterar uma divisão já respondida",
                )
            despesa.divisao.email_convidado = dados.divisao.email_convidado.lower()
            despesa.divisao.porcentagem = dados.divisao.porcentagem
        else:
            # Cria nova divisão
            divisao = DespesaDivisao(
                despesa_id=despesa.id,
                email_convidado=dados.divisao.email_convidado.lower(),
                porcentagem=dados.divisao.porcentagem,
                status=StatusDivisao.aguardando,
            )
            sessao.add(divisao)
    elif despesa.divisao and despesa.divisao.status == StatusDivisao.aguardando:
        # Remove divisão pendente se a edição não incluir divisão
        sessao.delete(despesa.divisao)

    sessao.commit()
    sessao.refresh(despesa)
    return despesa


@roteador.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def remover_despesa(
    id: int,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """Remove uma despesa. A divisão associada é removida em cascata."""
    despesa = sessao.get(Despesa, id)
    if not despesa:
        raise HTTPException(status_code=404, detail="Despesa não encontrada")

    _verificar_dono(despesa, usuario)
    sessao.delete(despesa)
    sessao.commit()


@roteador.get("/pendentes", response_model=List[RespostaDespesaPendente])
def listar_pendentes(
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """
    Retorna todas as divisões aguardando aprovação do usuário autenticado.
    O email do usuário é comparado com email_convidado nas divisões.
    Usado pelo frontend para exibir o modal bloqueante ao logar.
    """
    divisoes = (
        sessao.query(DespesaDivisao)
        .join(Despesa, DespesaDivisao.despesa_id == Despesa.id)
        .filter(
            DespesaDivisao.email_convidado == usuario.email.lower(),
            DespesaDivisao.status == StatusDivisao.aguardando,
        )
        .all()
    )

    resultado = []
    for div in divisoes:
        # Busca o nome do criador da despesa
        criador = sessao.get(Usuario, div.despesa.usuario_id)
        minha_parte = div.despesa.valor * div.porcentagem / Decimal("100")

        resultado.append(RespostaDespesaPendente(
            divisao_id=div.id,
            despesa=div.despesa,
            minha_parte=minha_parte.quantize(Decimal("0.01")),
            nome_criador=criador.nome if criador else None,
        ))

    return resultado


@roteador.post("/divisoes/{id}/responder", response_model=RespostaDivisao)
def responder_divisao(
    id: int,
    dados: EntradaResposta,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """
    Aceita ou nega uma divisão de despesa.

    Regras:
    - Apenas o convidado (email_convidado == usuario.email) pode responder
    - Só pode responder divisões com status "aguardando"
    - Ao negar, justificativa é obrigatória
    - Ao aceitar: vincula usuario_id_convidado e define confirmado_em
    """
    divisao = sessao.get(DespesaDivisao, id)

    if not divisao:
        raise HTTPException(status_code=404, detail="Divisão não encontrada")

    # Verifica que é o convidado respondendo
    if divisao.email_convidado != usuario.email.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você não é o destinatário desta divisão",
        )

    # Só pode responder se ainda aguardando
    if divisao.status != StatusDivisao.aguardando:
        raise HTTPException(
            status_code=400,
            detail=f"Esta divisão já foi respondida: {divisao.status.value}",
        )

    # Validação: negar exige justificativa
    if dados.resposta == StatusDivisao.negado:
        if not dados.justificativa or not dados.justificativa.strip():
            raise HTTPException(
                status_code=400,
                detail="Justificativa é obrigatória ao negar uma divisão",
            )

    # Aplica a resposta
    divisao.status = dados.resposta
    divisao.confirmado_em = datetime.utcnow()
    divisao.usuario_id_convidado = usuario.id

    if dados.resposta == StatusDivisao.negado:
        divisao.justificativa_negacao = dados.justificativa.strip()

    sessao.commit()
    sessao.refresh(divisao)
    return divisao


@roteador.get("/balanco", response_model=List[RespostaBalanco])
def calcular_balanco(
    mes: int,
    ano: int,
    usuario: Usuario = Depends(obter_usuario_atual),
    sessao: Session = Depends(obter_sessao),
):
    """
    Calcula o balanço mensal do usuário com cada parceiro.

    Para cada parceiro:
      total_eu_lancei  = soma(despesa.valor × divisao.porcentagem/100)
                         onde eu criei a despesa e o parceiro é o convidado

      total_ele_lancou = soma(despesa.valor × divisao.porcentagem/100)
                         onde o parceiro criou e eu aceitei (de_acordo)

      saldo = total_eu_lancei - total_ele_lancou
        → positivo: parceiro me deve
        → negativo: eu devo ao parceiro
    """
    inicio_mes = date(ano, mes, 1)
    fim_mes = (inicio_mes + relativedelta(months=1)) - timedelta(days=1)

    # 1. Despesas que eu criei com divisão aceita (de_acordo) no mês
    despesas_que_criei = (
        sessao.query(Despesa, DespesaDivisao)
        .join(DespesaDivisao, Despesa.id == DespesaDivisao.despesa_id)
        .filter(
            Despesa.usuario_id == usuario.id,
            DespesaDivisao.status == StatusDivisao.de_acordo,
        )
        .all()
    )

    # 2. Despesas que outros criaram e eu aceitei no mês
    despesas_que_aceitei = (
        sessao.query(Despesa, DespesaDivisao)
        .join(DespesaDivisao, Despesa.id == DespesaDivisao.despesa_id)
        .filter(
            DespesaDivisao.email_convidado == usuario.email.lower(),
            DespesaDivisao.status == StatusDivisao.de_acordo,
        )
        .all()
    )

    # Agrupa por parceiro
    parceiros: dict[str, dict] = {}

    # Despesas que eu criei — a parte do parceiro vai para "total_eu_lancei"
    for despesa, divisao in despesas_que_criei:
        # Verifica se a despesa tem ocorrência neste mês
        datas = _gerar_datas_recorrencia(despesa.data, despesa.recorrente, mes, ano)
        if not datas:
            continue

        email = divisao.email_convidado
        if email not in parceiros:
            # Busca nome do parceiro se ele for usuário cadastrado
            parceiro_usuario = sessao.query(Usuario).filter(
                Usuario.email == email
            ).first()
            parceiros[email] = {
                "parceiro_email": email,
                "parceiro_nome": parceiro_usuario.nome if parceiro_usuario else None,
                "total_eu_lancei": Decimal("0"),
                "total_ele_lancou": Decimal("0"),
            }

        # Soma por número de ocorrências no mês (relevante para recorrências diárias/semanais)
        valor_parcela = (despesa.valor * divisao.porcentagem / Decimal("100")).quantize(Decimal("0.01"))
        parceiros[email]["total_eu_lancei"] += valor_parcela * len(datas)

    # Despesas que o parceiro criou — minha parte vai para "total_ele_lancou"
    for despesa, divisao in despesas_que_aceitei:
        datas = _gerar_datas_recorrencia(despesa.data, despesa.recorrente, mes, ano)
        if not datas:
            continue

        # O criador é o parceiro
        criador = sessao.get(Usuario, despesa.usuario_id)
        email = criador.email if criador else str(despesa.usuario_id)

        if email not in parceiros:
            parceiros[email] = {
                "parceiro_email": email,
                "parceiro_nome": criador.nome if criador else None,
                "total_eu_lancei": Decimal("0"),
                "total_ele_lancou": Decimal("0"),
            }

        valor_parcela = (despesa.valor * divisao.porcentagem / Decimal("100")).quantize(Decimal("0.01"))
        parceiros[email]["total_ele_lancou"] += valor_parcela * len(datas)

    # Calcula saldo líquido para cada parceiro
    resultado = []
    for dados_parceiro in parceiros.values():
        saldo = dados_parceiro["total_eu_lancei"] - dados_parceiro["total_ele_lancou"]
        resultado.append(RespostaBalanco(
            parceiro_email=dados_parceiro["parceiro_email"],
            parceiro_nome=dados_parceiro["parceiro_nome"],
            saldo=saldo.quantize(Decimal("0.01")),
            total_eu_lancei=dados_parceiro["total_eu_lancei"],
            total_ele_lancou=dados_parceiro["total_ele_lancou"],
        ))

    # Ordena: maiores saldos primeiro (quem mais me deve aparece no topo)
    resultado.sort(key=lambda r: abs(r.saldo), reverse=True)
    return resultado
