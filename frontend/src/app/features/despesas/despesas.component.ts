/**
 * DespesasComponent — Página de despesas pessoais do usuário.
 *
 * Funcionalidades:
 *   - Resumo do mês (total, pago, pendente)
 *   - Tabela com colunas ordenáveis
 *   - Modal para criar/editar despesa
 *   - Confirmação de exclusão inline
 *   - Navegação por mês
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DespesaService } from '../../core/servicos/despesa.service';
import {
  Despesa,
  EntradaDespesa,
  RecorrenciaTipo,
  SituacaoDespesa,
  ROTULOS_RECORRENCIA,
} from '../../core/modelos/despesa';

/** Colunas disponíveis para ordenação da tabela */
type ColunaOrdenavel = 'data' | 'descricao' | 'valor' | 'recorrente' | 'situacao';

@Component({
  selector: 'app-despesas',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './despesas.component.html',
  styleUrl: './despesas.component.scss',
})
export class DespesasComponent implements OnInit {

  private despesaServico = inject(DespesaService);

  // ─── Estado da lista ───────────────────────────────────────────────────────

  despesas       = signal<Despesa[]>([]);
  carregando     = signal(false);
  erroLista      = signal<string | null>(null);

  // ─── Filtros de período ───────────────────────────────────────────────────

  mesAtual  = signal(new Date().getMonth() + 1);
  anoAtual  = signal(new Date().getFullYear());

  filtroSituacao = signal<SituacaoDespesa | ''>('');

  // ─── Ordenação ────────────────────────────────────────────────────────────

  colunaOrdem  = signal<ColunaOrdenavel>('data');
  direcaoOrdem = signal<'asc' | 'desc'>('desc');

  // ─── Modal de formulário ──────────────────────────────────────────────────

  mostrarFormulario = signal(false);

  /** null = nova despesa; Despesa = editando */
  despesaEmEdicao = signal<Despesa | null>(null);

  carregandoForm = signal(false);
  erroForm       = signal<string | null>(null);
  sucessoForm    = signal(false);

  // ─── Exclusão ─────────────────────────────────────────────────────────────

  /** ID da despesa que aguarda confirmação de exclusão */
  idParaExcluir  = signal<number | null>(null);
  excluindo      = signal(false);

  // ─── Campos do formulário ─────────────────────────────────────────────────

  form = {
    descricao:  signal(''),
    valor:      signal(''),
    data:       signal(this._dataHoje()),
    recorrente: signal<RecorrenciaTipo>('nao'),
    situacao:   signal<SituacaoDespesa>('pendente'),
  };

  // ─── Computed ─────────────────────────────────────────────────────────────

  /** Despesas filtradas por situação e ordenadas */
  despesasFiltradas = computed(() => {
    let lista = this.despesas();

    // Aplica filtro de situação
    const f = this.filtroSituacao();
    if (f) lista = lista.filter(d => d.situacao === f);

    // Ordena
    const col = this.colunaOrdem();
    const dir = this.direcaoOrdem();

    return [...lista].sort((a, b) => {
      let cmp = 0;
      switch (col) {
        case 'data':       cmp = a.data.localeCompare(b.data); break;
        case 'descricao':  cmp = a.descricao.localeCompare(b.descricao); break;
        case 'valor':      cmp = a.valor - b.valor; break;
        case 'recorrente': cmp = a.recorrente.localeCompare(b.recorrente); break;
        case 'situacao':   cmp = a.situacao.localeCompare(b.situacao); break;
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  /** Total gasto no mês (somente despesas sem divisão — pessoais) */
  totalMes = computed(() =>
    this.despesas()
      .filter(d => !d.divisao)
      .reduce((acc, d) => acc + d.valor, 0)
  );

  /** Total pago */
  totalPago = computed(() =>
    this.despesas()
      .filter(d => !d.divisao && d.situacao === 'pago')
      .reduce((acc, d) => acc + d.valor, 0)
  );

  /** Total pendente */
  totalPendente = computed(() =>
    this.despesas()
      .filter(d => !d.divisao && d.situacao === 'pendente')
      .reduce((acc, d) => acc + d.valor, 0)
  );

  /** Rótulo do período atual */
  rotuloPeriodo = computed(() => {
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${nomes[this.mesAtual() - 1]} ${this.anoAtual()}`;
  });

  /** Opções de recorrência para o select */
  readonly opcoesRecorrencia = Object.entries(ROTULOS_RECORRENCIA) as [RecorrenciaTipo, string][];

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() {
    this._carregarDespesas();
  }

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAnterior() {
    if (this.mesAtual() === 1) { this.mesAtual.set(12); this.anoAtual.update(a => a - 1); }
    else { this.mesAtual.update(m => m - 1); }
    this._carregarDespesas();
  }

  proximoMes() {
    if (this.mesAtual() === 12) { this.mesAtual.set(1); this.anoAtual.update(a => a + 1); }
    else { this.mesAtual.update(m => m + 1); }
    this._carregarDespesas();
  }

  // ─── Ordenação ────────────────────────────────────────────────────────────

  ordenarPor(col: ColunaOrdenavel) {
    if (this.colunaOrdem() === col) {
      this.direcaoOrdem.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.colunaOrdem.set(col);
      this.direcaoOrdem.set('asc');
    }
  }

  iconeOrdem(col: ColunaOrdenavel): string {
    if (this.colunaOrdem() !== col) return '↕';
    return this.direcaoOrdem() === 'asc' ? '↑' : '↓';
  }

  // ─── Formulário: criar ────────────────────────────────────────────────────

  abrirNovaDespesa() {
    this.despesaEmEdicao.set(null);
    this._resetarForm();
    this.mostrarFormulario.set(true);
  }

  // ─── Formulário: editar ───────────────────────────────────────────────────

  abrirEdicao(d: Despesa) {
    this.despesaEmEdicao.set(d);
    this.form.descricao.set(d.descricao);
    this.form.valor.set(String(d.valor));
    this.form.data.set(d.data);
    this.form.recorrente.set(d.recorrente);
    this.form.situacao.set(d.situacao);
    this.erroForm.set(null);
    this.sucessoForm.set(false);
    this.mostrarFormulario.set(true);
  }

  fecharFormulario() {
    this.mostrarFormulario.set(false);
  }

  /** Salva nova despesa ou edição */
  salvar() {
    this.erroForm.set(null);

    if (!this.form.descricao().trim()) {
      this.erroForm.set('Informe a descrição');
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

    const entrada: EntradaDespesa = {
      descricao:  this.form.descricao().trim(),
      valor:      valorNum,
      data:       this.form.data(),
      recorrente: this.form.recorrente(),
      situacao:   this.form.situacao(),
    };

    this.carregandoForm.set(true);
    const edicao = this.despesaEmEdicao();

    const obs$ = edicao
      ? this.despesaServico.editar(edicao.id, entrada)
      : this.despesaServico.criar(entrada);

    obs$.subscribe({
      next: () => {
        this.carregandoForm.set(false);
        this.sucessoForm.set(true);
        setTimeout(() => {
          this.mostrarFormulario.set(false);
          this.sucessoForm.set(false);
          this._carregarDespesas();
        }, 1200);
      },
      error: (e: Error) => {
        this.erroForm.set(e.message);
        this.carregandoForm.set(false);
      },
    });
  }

  // ─── Exclusão ─────────────────────────────────────────────────────────────

  confirmarExclusao(id: number) {
    this.idParaExcluir.set(id);
  }

  cancelarExclusao() {
    this.idParaExcluir.set(null);
  }

  excluir() {
    const id = this.idParaExcluir();
    if (!id) return;

    this.excluindo.set(true);
    this.despesaServico.remover(id).subscribe({
      next: () => {
        this.excluindo.set(false);
        this.idParaExcluir.set(null);
        // Remove localmente sem recarregar (otimista)
        this.despesas.update(lista => lista.filter(d => d.id !== id));
      },
      error: () => {
        this.excluindo.set(false);
        this.idParaExcluir.set(null);
      },
    });
  }

  // ─── Helpers de template ──────────────────────────────────────────────────

  moeda(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  formatarData(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  rotuloRecorrencia(tipo: string): string {
    return ROTULOS_RECORRENCIA[tipo as RecorrenciaTipo] ?? tipo;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private _carregarDespesas() {
    this.carregando.set(true);
    this.erroLista.set(null);

    this.despesaServico.listar({ mes: this.mesAtual(), ano: this.anoAtual() }).subscribe({
      next: (lista) => {
        // Exibe todas as despesas do usuário (pessoais + compartilhadas)
        this.despesas.set(lista);
        this.carregando.set(false);
      },
      error: (e: Error) => {
        this.erroLista.set(e.message);
        this.carregando.set(false);
      },
    });
  }

  private _resetarForm() {
    this.form.descricao.set('');
    this.form.valor.set('');
    this.form.data.set(this._dataHoje());
    this.form.recorrente.set('nao');
    this.form.situacao.set('pendente');
    this.erroForm.set(null);
    this.sucessoForm.set(false);
  }

  private _dataHoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
