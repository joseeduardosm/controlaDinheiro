/**
 * CasalComponent — Página de despesas compartilhadas do casal.
 *
 * Seções:
 *   1. Balanço do mês  — saldo líquido entre o usuário e cada parceiro
 *   2. Lista de despesas compartilhadas — tabela com colunas ordenáveis
 *   3. Nova despesa — abre o formulário em modal
 */

import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DespesaService } from '../../core/servicos/despesa.service';
import {
  Despesa,
  BalancoMensal,
  EntradaDespesa,
  RecorrenciaTipo,
  ROTULOS_RECORRENCIA,
} from '../../core/modelos/despesa';

/** Coluna pela qual a tabela pode ser ordenada */
type ColunaOrdenavel = 'data' | 'descricao' | 'valor' | 'minha_parte' | 'situacao' | 'status';

@Component({
  selector: 'app-casal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './casal.component.html',
  styleUrl: './casal.component.scss',
})
export class CasalComponent implements OnInit {

  private despesaServico = inject(DespesaService);

  // ─── Estado da lista ───────────────────────────────────────────────────────

  /** Lista bruta de despesas compartilhadas do mês */
  despesas = signal<Despesa[]>([]);

  /** true = carregando dados da API */
  carregandoLista = signal(false);

  /** Mês e ano do filtro (padrão = mês atual) */
  mesAtual   = signal(new Date().getMonth() + 1);
  anoAtual   = signal(new Date().getFullYear());

  // ─── Ordenação da tabela ───────────────────────────────────────────────────

  /** Coluna atualmente ordenada */
  colunaOrdem    = signal<ColunaOrdenavel>('data');

  /** Direção da ordenação */
  direcaoOrdem   = signal<'asc' | 'desc'>('desc');

  // ─── Balanço mensal ───────────────────────────────────────────────────────

  balanco        = signal<BalancoMensal[]>([]);
  carregandoBalanco = signal(false);

  // ─── Formulário de nova despesa ───────────────────────────────────────────

  /** Controla visibilidade do modal de nova despesa */
  mostrarFormulario = signal(false);

  /** true = o campo "dividir" está ativo */
  dividirDespesa = signal(false);

  /** Carregando envio do formulário */
  carregandoForm = signal(false);

  /** Mensagem de erro do formulário */
  erroForm = signal<string | null>(null);

  /** Mensagem de sucesso */
  sucessoForm = signal(false);

  /* Campos do formulário (como signals para consistência) */
  form = {
    descricao:    signal(''),
    valor:        signal(''),
    data:         signal(this._dataHoje()),
    recorrente:   signal<RecorrenciaTipo>('nao'),
    situacao:     signal<'pago' | 'pendente'>('pendente'),
    emailConvite: signal(''),
    porcentagem:  signal('50'),
  };

  // ─── Computed: despesas ordenadas ─────────────────────────────────────────

  /** Despesas filtradas e ordenadas para exibição na tabela */
  despesasOrdenadas = computed(() => {
    const lista    = this.despesas();
    const coluna   = this.colunaOrdem();
    const direcao  = this.direcaoOrdem();

    return [...lista].sort((a, b) => {
      let comparacao = 0;

      switch (coluna) {
        case 'data':       comparacao = a.data.localeCompare(b.data); break;
        case 'descricao':  comparacao = a.descricao.localeCompare(b.descricao); break;
        case 'valor':      comparacao = a.valor - b.valor; break;
        case 'minha_parte':
          // Ordena pela parte calculada a partir da divisão
          const parteA = a.divisao ? a.valor * (a.divisao.porcentagem / 100) : a.valor;
          const parteB = b.divisao ? b.valor * (b.divisao.porcentagem / 100) : b.valor;
          comparacao = parteA - parteB;
          break;
        case 'situacao':   comparacao = a.situacao.localeCompare(b.situacao); break;
        case 'status':
          const statusA = a.divisao?.status ?? '';
          const statusB = b.divisao?.status ?? '';
          comparacao = statusA.localeCompare(statusB);
          break;
      }

      return direcao === 'asc' ? comparacao : -comparacao;
    });
  });

  // ─── Opcoes de recorrência para o select ─────────────────────────────────

  /** Lista de opções de recorrência para o select do formulário */
  readonly opcoesRecorrencia = Object.entries(ROTULOS_RECORRENCIA) as [RecorrenciaTipo, string][];

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() {
    this._carregarDados();
  }

  // ─── Ações de tabela ──────────────────────────────────────────────────────

  /** Clique no cabeçalho de coluna — alterna ordenação */
  ordenarPor(coluna: ColunaOrdenavel) {
    if (this.colunaOrdem() === coluna) {
      // Inverte direção se já estiver nessa coluna
      this.direcaoOrdem.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.colunaOrdem.set(coluna);
      this.direcaoOrdem.set('asc');
    }
  }

  /** Ícone de ordenação para o cabeçalho */
  iconeOrdem(coluna: ColunaOrdenavel): string {
    if (this.colunaOrdem() !== coluna) return '↕';
    return this.direcaoOrdem() === 'asc' ? '↑' : '↓';
  }

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAnterior() {
    if (this.mesAtual() === 1) {
      this.mesAtual.set(12);
      this.anoAtual.update(a => a - 1);
    } else {
      this.mesAtual.update(m => m - 1);
    }
    this._carregarDados();
  }

  proximoMes() {
    if (this.mesAtual() === 12) {
      this.mesAtual.set(1);
      this.anoAtual.update(a => a + 1);
    } else {
      this.mesAtual.update(m => m + 1);
    }
    this._carregarDados();
  }

  /** Rótulo legível do mês/ano */
  rotuloPeriodo = computed(() => {
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${nomes[this.mesAtual() - 1]} ${this.anoAtual()}`;
  });

  // ─── Formulário ───────────────────────────────────────────────────────────

  abrirFormulario() {
    this._resetarForm();
    this.mostrarFormulario.set(true);
  }

  fecharFormulario() {
    this.mostrarFormulario.set(false);
  }

  /** Submete o formulário de nova despesa */
  salvarDespesa() {
    this.erroForm.set(null);

    // Validação básica
    if (!this.form.descricao().trim()) {
      this.erroForm.set('Informe a descrição da despesa');
      return;
    }
    const valorNum = parseFloat(this.form.valor().replace(',', '.'));
    if (!valorNum || valorNum <= 0) {
      this.erroForm.set('Informe um valor válido');
      return;
    }
    if (!this.form.data()) {
      this.erroForm.set('Informe a data');
      return;
    }

    // Monta payload
    const entrada: EntradaDespesa = {
      descricao:  this.form.descricao().trim(),
      valor:      valorNum,
      data:       this.form.data(),
      recorrente: this.form.recorrente(),
      situacao:   this.form.situacao(),
    };

    // Adiciona divisão se ativado
    if (this.dividirDespesa()) {
      if (!this.form.emailConvite().trim()) {
        this.erroForm.set('Informe o e-mail do parceiro');
        return;
      }
      const pct = parseFloat(this.form.porcentagem());
      if (!pct || pct <= 0 || pct >= 100) {
        this.erroForm.set('A porcentagem do parceiro deve ser entre 1% e 99%');
        return;
      }
      entrada.divisao = {
        email_convidado: this.form.emailConvite().trim(),
        porcentagem:     pct,
      };
    }

    this.carregandoForm.set(true);

    this.despesaServico.criar(entrada).subscribe({
      next: () => {
        this.carregandoForm.set(false);
        this.sucessoForm.set(true);
        // Fecha após 1,5s e recarrega lista
        setTimeout(() => {
          this.mostrarFormulario.set(false);
          this.sucessoForm.set(false);
          this._carregarDados();
        }, 1500);
      },
      error: (e: Error) => {
        this.erroForm.set(e.message);
        this.carregandoForm.set(false);
      },
    });
  }

  // ─── Helpers de template ──────────────────────────────────────────────────

  /** Formata valor como moeda brasileira */
  moeda(valor: number): string {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Formata data "YYYY-MM-DD" para "DD/MM" */
  formatarData(dataIso: string): string {
    const [, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}`;
  }

  /** Rótulo legível da recorrência */
  rotuloRecorrencia(tipo: string): string {
    return ROTULOS_RECORRENCIA[tipo as RecorrenciaTipo] ?? tipo;
  }

  /** Rótulo do status da divisão */
  rotuloStatus(status: string): string {
    const mapa: Record<string, string> = {
      aguardando: 'Aguardando',
      de_acordo: 'De acordo',
      negado: 'Negado',
    };
    return mapa[status] ?? status;
  }

  /** Calcula minha parte na despesa */
  minhaParte(despesa: Despesa): number {
    if (!despesa.divisao) return despesa.valor;
    // Se EU sou o criador, minha parte é (100 - porcentagem_dele)
    // Mas o endpoint de listagem retorna as despesas DO usuário,
    // então sempre somos o criador aqui — a parte do parceiro está em divisao.porcentagem
    return despesa.valor * (1 - despesa.divisao.porcentagem / 100);
  }

  /** Valor absoluto — necessário para usar em templates Angular */
  absValor(n: number): number {
    return Math.abs(n);
  }

  /** Rótulo do saldo do balanço */
  rotuloBalanco(item: BalancoMensal): string {
    if (item.saldo === 0) return `Sem saldo com ${item.parceiro_nome ?? item.parceiro_email}`;
    const nome = item.parceiro_nome ?? item.parceiro_email;
    if (item.saldo > 0) return `${nome} te deve ${this.moeda(Math.abs(item.saldo))}`;
    return `Você deve ${this.moeda(Math.abs(item.saldo))} para ${nome}`;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private _carregarDados() {
    // Carrega despesas do mês
    this.carregandoLista.set(true);
    this.despesaServico.listar({ mes: this.mesAtual(), ano: this.anoAtual() }).subscribe({
      next: (lista) => {
        // Filtra apenas despesas que têm divisão (compartilhadas)
        this.despesas.set(lista.filter(d => !!d.divisao));
        this.carregandoLista.set(false);
      },
      error: () => this.carregandoLista.set(false),
    });

    // Carrega balanço do mês
    this.carregandoBalanco.set(true);
    this.despesaServico.balanco(this.mesAtual(), this.anoAtual()).subscribe({
      next: (b) => {
        this.balanco.set(b);
        this.carregandoBalanco.set(false);
      },
      error: () => this.carregandoBalanco.set(false),
    });
  }

  private _resetarForm() {
    this.form.descricao.set('');
    this.form.valor.set('');
    this.form.data.set(this._dataHoje());
    this.form.recorrente.set('nao');
    this.form.situacao.set('pendente');
    this.form.emailConvite.set('');
    this.form.porcentagem.set('50');
    this.dividirDespesa.set(false);
    this.erroForm.set(null);
    this.sucessoForm.set(false);
  }

  private _dataHoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
