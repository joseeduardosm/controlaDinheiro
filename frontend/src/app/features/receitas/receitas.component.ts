/**
 * ReceitasComponent — Página de receitas do usuário.
 *
 * Funcionalidades:
 *   - Resumo do mês (total, recebido, pendente)
 *   - Tabela com colunas ordenáveis
 *   - Modal para criar/editar receita
 *   - Confirmação de exclusão inline
 *   - Navegação por mês
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ReceitaService } from '../../core/servicos/receita.service';
import {
  Receita,
  EntradaReceita,
  ResumoReceitas,
  RecorrenciaTipo,
  SituacaoReceita,
  ROTULOS_RECORRENCIA,
} from '../../core/modelos/receita';

/** Colunas disponíveis para ordenação da tabela */
type ColunaOrdenavel = 'data' | 'descricao' | 'valor' | 'recorrente' | 'situacao';

@Component({
  selector: 'app-receitas',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './receitas.component.html',
  styleUrl: './receitas.component.scss',
})
export class ReceitasComponent implements OnInit {

  private receitaServico = inject(ReceitaService);

  // ─── Estado ───────────────────────────────────────────────────────────────

  receitas       = signal<Receita[]>([]);
  resumo         = signal<ResumoReceitas>({ total: 0, recebido: 0, pendente: 0, quantidade: 0 });
  carregando     = signal(false);
  erroLista      = signal<string | null>(null);

  mesAtual       = signal(new Date().getMonth() + 1);
  anoAtual       = signal(new Date().getFullYear());
  filtroSituacao = signal<SituacaoReceita | ''>('');

  // ─── Ordenação ────────────────────────────────────────────────────────────

  colunaOrdem  = signal<ColunaOrdenavel>('data');
  direcaoOrdem = signal<'asc' | 'desc'>('desc');

  // ─── Formulário ───────────────────────────────────────────────────────────

  mostrarFormulario = signal(false);
  receitaEmEdicao   = signal<Receita | null>(null);
  carregandoForm    = signal(false);
  erroForm          = signal<string | null>(null);
  sucessoForm       = signal(false);

  // ─── Exclusão ─────────────────────────────────────────────────────────────

  idParaExcluir = signal<number | null>(null);
  excluindo     = signal(false);

  // ─── Campos do formulário ─────────────────────────────────────────────────

  form = {
    descricao:  signal(''),
    valor:      signal(''),
    data:       signal(this._dataHoje()),
    recorrente: signal<RecorrenciaTipo>('nao'),
    situacao:   signal<SituacaoReceita>('pendente'),
  };

  // ─── Computed ─────────────────────────────────────────────────────────────

  receitasFiltradas = computed(() => {
    let lista = this.receitas();
    const f   = this.filtroSituacao();
    if (f) lista = lista.filter(r => r.situacao === f);

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

  rotuloPeriodo = computed(() => {
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${nomes[this.mesAtual() - 1]} ${this.anoAtual()}`;
  });

  readonly opcoesRecorrencia = Object.entries(ROTULOS_RECORRENCIA) as [RecorrenciaTipo, string][];

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() {
    this._carregarDados();
  }

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAnterior() {
    if (this.mesAtual() === 1) { this.mesAtual.set(12); this.anoAtual.update(a => a - 1); }
    else { this.mesAtual.update(m => m - 1); }
    this._carregarDados();
  }

  proximoMes() {
    if (this.mesAtual() === 12) { this.mesAtual.set(1); this.anoAtual.update(a => a + 1); }
    else { this.mesAtual.update(m => m + 1); }
    this._carregarDados();
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

  // ─── Formulário ───────────────────────────────────────────────────────────

  abrirNovaReceita() {
    this.receitaEmEdicao.set(null);
    this._resetarForm();
    this.mostrarFormulario.set(true);
  }

  abrirEdicao(r: Receita) {
    this.receitaEmEdicao.set(r);
    this.form.descricao.set(r.descricao);
    this.form.valor.set(String(r.valor));
    this.form.data.set(r.data);
    this.form.recorrente.set(r.recorrente);
    this.form.situacao.set(r.situacao);
    this.erroForm.set(null);
    this.sucessoForm.set(false);
    this.mostrarFormulario.set(true);
  }

  fecharFormulario() {
    this.mostrarFormulario.set(false);
  }

  salvar() {
    this.erroForm.set(null);

    if (!this.form.descricao().trim()) { this.erroForm.set('Informe a descrição'); return; }
    const valorNum = parseFloat(this.form.valor().replace(',', '.'));
    if (!valorNum || valorNum <= 0) { this.erroForm.set('Informe um valor válido'); return; }
    if (!this.form.data()) { this.erroForm.set('Informe a data'); return; }

    const entrada: EntradaReceita = {
      descricao:  this.form.descricao().trim(),
      valor:      valorNum,
      data:       this.form.data(),
      recorrente: this.form.recorrente(),
      situacao:   this.form.situacao(),
    };

    this.carregandoForm.set(true);
    const edicao = this.receitaEmEdicao();

    const obs$ = edicao
      ? this.receitaServico.editar(edicao.id, entrada)
      : this.receitaServico.criar(entrada);

    obs$.subscribe({
      next: () => {
        this.carregandoForm.set(false);
        this.sucessoForm.set(true);
        setTimeout(() => {
          this.mostrarFormulario.set(false);
          this.sucessoForm.set(false);
          this._carregarDados();
        }, 1200);
      },
      error: (e: Error) => {
        this.erroForm.set(e.message);
        this.carregandoForm.set(false);
      },
    });
  }

  // ─── Exclusão ─────────────────────────────────────────────────────────────

  confirmarExclusao(id: number) { this.idParaExcluir.set(id); }
  cancelarExclusao()            { this.idParaExcluir.set(null); }

  excluir() {
    const id = this.idParaExcluir();
    if (!id) return;
    this.excluindo.set(true);
    this.receitaServico.remover(id).subscribe({
      next: () => {
        this.excluindo.set(false);
        this.idParaExcluir.set(null);
        this.receitas.update(lista => lista.filter(r => r.id !== id));
        // Recalcula resumo com os dados atualizados
        this._carregarResumo();
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

  private _carregarDados() {
    this.carregando.set(true);
    this.erroLista.set(null);

    this.receitaServico.listar({ mes: this.mesAtual(), ano: this.anoAtual() }).subscribe({
      next: (lista) => {
        this.receitas.set(lista);
        this.carregando.set(false);
      },
      error: (e: Error) => { this.erroLista.set(e.message); this.carregando.set(false); },
    });

    this._carregarResumo();
  }

  private _carregarResumo() {
    this.receitaServico.resumo(this.mesAtual(), this.anoAtual()).subscribe({
      next: (r) => this.resumo.set(r),
      error: () => {},
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
