"""
modelos.py — Modelos ORM (tabelas do banco de dados).

Cada classe representa uma tabela no PostgreSQL.
O create_all no main.py cria as tabelas automaticamente ao subir a API.
"""

import enum
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, Boolean, DateTime, Date, Numeric, Enum, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from banco import Base


class Usuario(Base):
    """
    Tabela: usuarios

    Armazena as credenciais e dados básicos de cada usuário.
    Um usuário pode fazer parte de um ou mais pares (casal) — relacionamento futuro.
    """
    __tablename__ = "usuarios"

    # Identificador único auto-incrementado
    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Nome de exibição (mínimo 2 caracteres — validado no schema Pydantic)
    nome: Mapped[str] = mapped_column(String(120), nullable=False)

    # E-mail único — usado como login
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    # Senha em hash bcrypt — NUNCA armazenar senha em texto puro
    senha_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Conta ativa? Desativada em vez de deletada (soft delete)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Timestamps automáticos
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),  # definido pelo banco
        nullable=False,
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),  # atualizado automaticamente pelo SQLAlchemy
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<Usuario id={self.id} email={self.email!r}>"


# ─── Enums de domínio ────────────────────────────────────────────────────────

class SituacaoReceita(str, enum.Enum):
    """Estado de recebimento de uma receita."""
    recebido = "recebido"
    pendente  = "pendente"


class RecorrenciaTipo(str, enum.Enum):
    """Frequência de repetição de uma despesa."""
    nao         = "nao"
    diario      = "diario"
    semanal     = "semanal"
    quinzenal   = "quinzenal"
    mensal      = "mensal"
    trimestral  = "trimestral"
    semestral   = "semestral"
    anual       = "anual"


class SituacaoDespesa(str, enum.Enum):
    """Estado de pagamento da despesa."""
    pago    = "pago"
    pendente = "pendente"


class StatusDivisao(str, enum.Enum):
    """Estado da aprovação de uma despesa compartilhada."""
    aguardando = "aguardando"  # convidado ainda não respondeu
    de_acordo  = "de_acordo"   # convidado aceitou
    negado     = "negado"      # convidado recusou (com justificativa)


# ─── Modelo: Despesa ──────────────────────────────────────────────────────────

class Despesa(Base):
    """
    Tabela: despesas

    Registra cada despesa do usuário. Pode ser recorrente e/ou compartilhada.
    Despesas compartilhadas têm um registro em DespesaDivisao associado.
    """
    __tablename__ = "despesas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Dono da despesa — quem criou e é responsável pelo valor total
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    descricao: Mapped[str] = mapped_column(String(255), nullable=False)

    # Valor total da despesa (antes da divisão)
    valor: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Data de competência (quando a despesa ocorre/ocorreu)
    data: Mapped[date] = mapped_column(Date, nullable=False)

    # Recorrência: "nao" = despesa única; outros valores = se repete
    recorrente: Mapped[RecorrenciaTipo] = mapped_column(
        Enum(RecorrenciaTipo, name="recorrencia_tipo"),
        default=RecorrenciaTipo.nao,
        nullable=False,
    )

    # Caminho/URL do comprovante (PDF, imagem) — opcional
    comprovante_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Situação de pagamento: já foi pago ou está pendente
    situacao: Mapped[SituacaoDespesa] = mapped_column(
        Enum(SituacaoDespesa, name="situacao_despesa"),
        default=SituacaoDespesa.pendente,
        nullable=False,
    )

    # Timestamps
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relacionamentos
    usuario: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[usuario_id])
    divisao: Mapped["DespesaDivisao | None"] = relationship(
        "DespesaDivisao", back_populates="despesa", uselist=False, cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Despesa id={self.id} descricao={self.descricao!r} valor={self.valor}>"


# ─── Modelo: DespesaDivisao ───────────────────────────────────────────────────

class DespesaDivisao(Base):
    """
    Tabela: despesa_divisoes

    Registra a divisão de uma despesa entre o criador e outro usuário.
    Uma despesa pode ter no máximo uma divisão (1:1).

    Fluxo:
      1. Criador define email_convidado e porcentagem (parte do convidado)
      2. Status inicia em "aguardando"
      3. Ao logar, convidado vê modal com pendências e responde
      4. "de_acordo" → provisiona a parte do convidado em seu fluxo de caixa
      5. "negado"    → justificativa fica registrada para o criador ver
    """
    __tablename__ = "despesa_divisoes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Referência à despesa pai
    despesa_id: Mapped[int] = mapped_column(
        ForeignKey("despesas.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # cada despesa tem no máximo uma divisão
        index=True,
    )

    # E-mail do usuário convidado (usado mesmo que ele ainda não tenha conta)
    email_convidado: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # ID do usuário convidado — preenchido quando ele aceita (pode não ter conta ainda)
    usuario_id_convidado: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Percentual da despesa que cabe ao convidado (0.00 a 100.00)
    porcentagem: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    # Estado da aprovação
    status: Mapped[StatusDivisao] = mapped_column(
        Enum(StatusDivisao, name="status_divisao"),
        default=StatusDivisao.aguardando,
        nullable=False,
    )

    # Motivo da recusa — obrigatório quando status = negado
    justificativa_negacao: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Quando o convidado respondeu (aceitar ou negar)
    confirmado_em: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relacionamentos
    despesa: Mapped["Despesa"] = relationship("Despesa", back_populates="divisao")
    usuario_convidado: Mapped["Usuario | None"] = relationship(
        "Usuario", foreign_keys=[usuario_id_convidado]
    )

    def __repr__(self) -> str:
        return f"<DespesaDivisao id={self.id} despesa_id={self.despesa_id} status={self.status}>"


# ─── Modelo: Receita ──────────────────────────────────────────────────────────

class Receita(Base):
    """
    Tabela: receitas

    Registra cada entrada financeira do usuário (salário, freelance, etc.).
    Pode ser recorrente — a lógica de expansão mensal é idêntica à de Despesa.
    """
    __tablename__ = "receitas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Dono da receita
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    descricao: Mapped[str] = mapped_column(String(255), nullable=False)

    # Valor bruto da receita
    valor: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Data de competência
    data: Mapped[date] = mapped_column(Date, nullable=False)

    # Recorrência — reutiliza o mesmo enum de Despesa
    recorrente: Mapped[RecorrenciaTipo] = mapped_column(
        Enum(RecorrenciaTipo, name="recorrencia_tipo"),
        default=RecorrenciaTipo.nao,
        nullable=False,
    )

    # Comprovante opcional (holerite, nota fiscal, etc.)
    comprovante_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Situação: já foi recebido ou está pendente
    situacao: Mapped[SituacaoReceita] = mapped_column(
        Enum(SituacaoReceita, name="situacao_receita"),
        default=SituacaoReceita.pendente,
        nullable=False,
    )

    # Timestamps
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relacionamento com o usuário
    usuario: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[usuario_id])

    def __repr__(self) -> str:
        return f"<Receita id={self.id} descricao={self.descricao!r} valor={self.valor}>"


# ─── Modelo: Conquista ────────────────────────────────────────────────────────

class Conquista(Base):
    """
    Tabela: conquistas

    Meta de poupança do usuário (viagem, reserva, compra, etc.).
    O valor acumulado é calculado dinamicamente a partir dos Aportes.
    """
    __tablename__ = "conquistas"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Nome do objetivo (ex: "Viagem Europa", "Reserva de emergência")
    nome: Mapped[str] = mapped_column(String(255), nullable=False)

    # Descrição opcional
    descricao: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Valor alvo total
    meta: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # Data limite para atingir o objetivo
    prazo: Mapped[date] = mapped_column(Date, nullable=False)

    # Emoji ou ícone representativo (ex: "✈️", "🏠")
    emoji: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # false = objetivo concluído ou arquivado
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    usuario: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[usuario_id])
    aportes: Mapped[list["Aporte"]] = relationship(
        "Aporte", back_populates="conquista", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Conquista id={self.id} nome={self.nome!r} meta={self.meta}>"


# ─── Modelo: Aporte ───────────────────────────────────────────────────────────

class Aporte(Base):
    """
    Tabela: aportes

    Cada aporte representa um depósito feito em direção a uma Conquista.
    A soma dos aportes determina o valor acumulado da meta.
    """
    __tablename__ = "aportes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    conquista_id: Mapped[int] = mapped_column(
        ForeignKey("conquistas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    valor: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # Data em que o aporte foi realizado
    data: Mapped[date] = mapped_column(Date, nullable=False)

    # Nota livre (ex: "13º salário", "bônus")
    descricao: Mapped[str | None] = mapped_column(String(255), nullable=True)

    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    conquista: Mapped["Conquista"] = relationship("Conquista", back_populates="aportes")

    def __repr__(self) -> str:
        return f"<Aporte id={self.id} conquista_id={self.conquista_id} valor={self.valor}>"


# ─── Enum: StatusDivisaoCartao ────────────────────────────────────────────────

class StatusDivisaoCartao(str, enum.Enum):
    """Estado da aprovação de um lançamento de cartão compartilhado."""
    aguardando = "aguardando"
    de_acordo  = "de_acordo"
    negado     = "negado"


class SituacaoLancamento(str, enum.Enum):
    """Indica se a parcela do cartão já foi paga na fatura."""
    pago    = "pago"
    pendente = "pendente"


# ─── Modelo: Cartao ───────────────────────────────────────────────────────────

class Cartao(Base):
    """
    Tabela: cartoes

    Representa um cartão de crédito do usuário.
    - fechamento: dia do mês em que a fatura fecha (1–31)
    - vencimento: dia do mês em que a fatura vence (1–31)
    """
    __tablename__ = "cartoes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Ex: "Nubank", "Itaú Platinum", "Bradesco Visa"
    banco: Mapped[str] = mapped_column(String(100), nullable=False)

    # Limite total do cartão
    limite: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    # Dia do mês em que a fatura fecha (1–31)
    fechamento: Mapped[int] = mapped_column(nullable=False)

    # Dia do mês em que a fatura vence (1–31)
    vencimento: Mapped[int] = mapped_column(nullable=False)

    # false = cartão encerrado
    ativo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    usuario: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[usuario_id])
    lancamentos: Mapped[list["CartaoLancamento"]] = relationship(
        "CartaoLancamento", back_populates="cartao", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Cartao id={self.id} banco={self.banco!r}>"


# ─── Modelo: CartaoLancamento ─────────────────────────────────────────────────

class CartaoLancamento(Base):
    """
    Tabela: cartao_lancamentos

    Cada lançamento representa uma compra parcelada (ou à vista = 1x) no cartão.

    Cálculo de parcelas:
      - parcela_inicial: normalmente 1; pode ser > 1 se a compra já estava em andamento
      - parcela_final: número da última parcela (ex: 12 para 12x)
      - valor_parcela: valor de cada parcela (calculado no frontend se o usuário
        informar o valor total)

    Divisão:
      - dividido_email: e-mail do parceiro que divide a despesa
      - dividido_porcentagem: % que cabe ao parceiro (0–100)
      - divisao_status: aguardando → parceiro ainda não respondeu
    """
    __tablename__ = "cartao_lancamentos"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    cartao_id: Mapped[int] = mapped_column(
        ForeignKey("cartoes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Usuário que registrou o lançamento
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    descricao: Mapped[str] = mapped_column(String(255), nullable=False)

    # Valor de CADA parcela (valor total / número de parcelas)
    valor_parcela: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    # Parcela inicial (default 1)
    parcela_inicial: Mapped[int] = mapped_column(default=1, nullable=False)

    # Última parcela (igual a parcela_inicial para compra à vista)
    parcela_final: Mapped[int] = mapped_column(nullable=False)

    # Data da compra — usada para calcular em qual fatura cada parcela cai
    data_compra: Mapped[date] = mapped_column(Date, nullable=False)

    # Situação de pagamento desta parcela
    situacao: Mapped[SituacaoLancamento] = mapped_column(
        Enum(SituacaoLancamento, name="situacao_lancamento"),
        default=SituacaoLancamento.pendente,
        nullable=False,
    )

    # Divisão — campos opcionais
    dividido_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dividido_porcentagem: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    divisao_status: Mapped[StatusDivisaoCartao | None] = mapped_column(
        Enum(StatusDivisaoCartao, name="status_divisao_cartao"),
        nullable=True,
    )
    justificativa_negacao: Mapped[str | None] = mapped_column(Text, nullable=True)

    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    cartao: Mapped["Cartao"] = relationship("Cartao", back_populates="lancamentos")
    usuario: Mapped["Usuario"] = relationship("Usuario", foreign_keys=[usuario_id])

    def __repr__(self) -> str:
        return f"<CartaoLancamento id={self.id} descricao={self.descricao!r} valor_parcela={self.valor_parcela}>"
