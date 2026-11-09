/**
 * CartoesComponent — Página de cartões de crédito e faturas.
 *
 * Funcionalidades:
 *   - Selector de cartões (chips)
 *   - Navegação por mês
 *   - Tiles de resumo da fatura (total, pago, a pagar)
 *   - Tabela de lançamentos com colunas ordenáveis
 *   - Modal de novo lançamento: valor total OU por parcela
 *   - Modal de novo cartão
 *   - Toggle pago/pendente direto na tabela
 *   - Remoção com confirmação inline
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CartaoService }    from '../../core/servicos/cartao.service';
import {
  Cartao, EntradaCartao, LancamentoFatura, EntradaLancamento, ResumoFatura,
} from '../../core/modelos/cartao';

/** Coluna pela qual a tabela está ordenada. */
type ColunaOrdem = 'data_vencimento' | 'descricao' | 'valor_parcela' | 'parcela' | 'situacao';

@Component({
  selector: 'app-cartoes',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cartoes.component.html',
  styleUrl: './cartoes.component.scss',
})
export class CartoesComponent implements OnInit {

  private cartaoServico = inject(CartaoService);

  // ─── Estado principal ─────────────────────────────────────────────────────

  cartoes         = signal<Cartao[]>([]);
  cartaoSelecionado = signal<Cartao | null>(null);
  lancamentos     = signal<LancamentoFatura[]>([]);
  resumo          = signal<ResumoFatura>({ total: 0, pago: 0, pendente: 0, quantidade: 0 });
  carregando      = signal(false);
  erroLista       = signal<string | null>(null);

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAtual  = signal(new Date().getMonth() + 1);   // 1–12
  anoAtual  = signal(new Date().getFullYear());

  rotuloPeriodo = computed(() => {
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${meses[this.mesAtual() - 1]} ${this.anoAtual()}`;
  });

  // ─── Ordenação da tabela ──────────────────────────────────────────────────

  colunaOrdem  = signal<ColunaOrdem>('data_vencimento');
  direcaoOrdem = signal<'asc' | 'desc'>('asc');

  lancamentosOrdenados = computed(() => {
    const lista = [...this.lancamentos()];
    const col   = this.colunaOrdem();
    const dir   = this.direcaoOrdem() === 'asc' ? 1 : -1;

    return lista.sort((a, b) => {
      let va: any;
      let vb: any;

      if (col === 'data_vencimento') { va = a.data_vencimento; vb = b.data_vencimento; }
      else if (col === 'descricao')  { va = a.descricao.toLowerCase(); vb = b.descricao.toLowerCase(); }
      else if (col === 'valor_parcela') { va = a.valor_parcela; vb = b.valor_parcela; }
      else if (col === 'parcela')    { va = a.parcela_atual; vb = b.parcela_atual; }
      else                           { va = a.situacao; vb = b.situacao; }

      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
  });

  // ─── Remoção inline ───────────────────────────────────────────────────────

  idParaRemover = signal<number | null>(null);
  removendo     = signal(false);

  // ─── Remoção de cartão ────────────────────────────────────────────────────

  idCartaoParaRemover = signal<number | null>(null);
  removendoCartao     = signal(false);

  // ─── Modal de lançamento ──────────────────────────────────────────────────

  mostrarFormLancamento  = signal(false);
  lancamentoEmEdicao     = signal<LancamentoFatura | null>(null);
  carregandoFormLanc     = signal(false);
  erroFormLanc           = signal<string | null>(null);
  sucessoFormLanc        = signal(false);

  /** Modo de entrada do valor: 'total' ou 'parcela'. */
  modoValor = signal<'total' | 'parcela'>('total');

  formLancamento = {
    descricao:     signal(''),
    valorTotal:    signal(''),     // usado quando modoValor = 'total'
    valorParcela:  signal(''),     // usado quando modoValor = 'parcela'
    nParcelas:     signal('1'),    // número de parcelas
    dataCompra:    signal(this._dataHoje()),
    situacao:      signal<'pago' | 'pendente'>('pendente'),
    dividir:       signal(false),
    dividirEmail:  signal(''),
    dividirPct:    signal(''),
  };

  // ─── Modal de cartão ──────────────────────────────────────────────────────

  mostrarFormCartao  = signal(false);
  cartaoEmEdicao     = signal<Cartao | null>(null);
  carregandoFormCart = signal(false);
  erroFormCart       = signal<string | null>(null);
  sucessoFormCart    = signal(false);

  formCartao = {
    banco:      signal(''),
    limite:     signal(''),
    fechamento: signal(''),
    vencimento: signal(''),
  };

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() {
    this._carregarCartoes();
  }

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAnterior() {
    if (this.mesAtual() === 1) { this.mesAtual.set(12); this.anoAtual.update(a => a - 1); }
    else                        { this.mesAtual.update(m => m - 1); }
    this._carregarFatura();
  }

  proximoMes() {
    if (this.mesAtual() === 12) { this.mesAtual.set(1); this.anoAtual.update(a => a + 1); }
    else                         { this.mesAtual.update(m => m + 1); }
    this._carregarFatura();
  }

  // ─── Seleção de cartão ────────────────────────────────────────────────────

  selecionarCartao(cartao: Cartao) {
    this.cartaoSelecionado.set(cartao);
    this._carregarFatura();
  }

  // ─── Ordenação da tabela ──────────────────────────────────────────────────

  ordenarPor(coluna: ColunaOrdem) {
    if (this.colunaOrdem() === coluna) {
      this.direcaoOrdem.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.colunaOrdem.set(coluna);
      this.direcaoOrdem.set('asc');
    }
  }

  iconeOrdem(coluna: ColunaOrdem): string {
    if (this.colunaOrdem() !== coluna) return '↕';
    return this.direcaoOrdem() === 'asc' ? '↑' : '↓';
  }

  // ─── Toggle situação ──────────────────────────────────────────────────────

  alternarSituacao(lanc: LancamentoFatura) {
    const nova: 'pago' | 'pendente' = lanc.situacao === 'pago' ? 'pendente' : 'pago';
    this.cartaoServico.alterarSituacao(lanc.id, nova).subscribe({
      next: (atualizado) => {
        this.lancamentos.update(lista =>
          lista.map(l => l.id === atualizado.id ? { ...l, situacao: atualizado.situacao } : l)
        );
        // Recalcula resumo local
        const total    = this.lancamentos().reduce((s, l) => s + l.valor_parcela, 0);
        const pago     = this.lancamentos().filter(l => l.situacao === 'pago').reduce((s, l) => s + l.valor_parcela, 0);
        const pendente = total - pago;
        this.resumo.set({ ...this.resumo(), total, pago, pendente });
      },
      error: () => {},
    });
  }

  // ─── Remoção de lançamento ────────────────────────────────────────────────

  confirmarRemocao(id: number) { this.idParaRemover.set(id); }
  cancelarRemocao()            { this.idParaRemover.set(null); }

  removerLancamento() {
    const id = this.idParaRemover();
    if (!id) return;
    this.removendo.set(true);
    this.cartaoServico.removerLancamento(id).subscribe({
      next: () => {
        this.lancamentos.update(lista => lista.filter(l => l.id !== id));
        this.idParaRemover.set(null);
        this.removendo.set(false);
        this._recalcularResumoLocal();
      },
      error: () => { this.removendo.set(false); this.idParaRemover.set(null); },
    });
  }

  // ─── Remoção de cartão ────────────────────────────────────────────────────

  confirmarRemocaoCartao(id: number) { this.idCartaoParaRemover.set(id); }
  cancelarRemocaoCartao()            { this.idCartaoParaRemover.set(null); }

  removerCartao() {
    const id = this.idCartaoParaRemover();
    if (!id) return;
    this.removendoCartao.set(true);
    this.cartaoServico.remover(id).subscribe({
      next: () => {
        this.cartoes.update(lista => lista.filter(c => c.id !== id));
        this.idCartaoParaRemover.set(null);
        this.removendoCartao.set(false);
        // Se era o cartão selecionado, deseleciona
        if (this.cartaoSelecionado()?.id === id) {
          const restantes = this.cartoes();
          this.cartaoSelecionado.set(restantes.length > 0 ? restantes[0] : null);
          if (restantes.length > 0) this._carregarFatura();
          else { this.lancamentos.set([]); this.resumo.set({ total: 0, pago: 0, pendente: 0, quantidade: 0 }); }
        }
      },
      error: () => { this.removendoCartao.set(false); this.idCartaoParaRemover.set(null); },
    });
  }

  // ─── Modal de lançamento ──────────────────────────────────────────────────

  abrirNovoLancamento() {
    this.lancamentoEmEdicao.set(null);
    this._resetarFormLancamento();
    this.mostrarFormLancamento.set(true);
  }

  abrirEdicaoLancamento(lanc: LancamentoFatura) {
    this.lancamentoEmEdicao.set(lanc);
    this.modoValor.set('parcela');
    this.formLancamento.descricao.set(lanc.descricao);
    this.formLancamento.valorParcela.set(String(lanc.valor_parcela));
    this.formLancamento.nParcelas.set(String(lanc.parcela_total));
    this.formLancamento.dataCompra.set(lanc.data_compra);
    this.formLancamento.situacao.set(lanc.situacao);
    this.formLancamento.dividir.set(!!lanc.dividido_email);
    this.formLancamento.dividirEmail.set(lanc.dividido_email ?? '');
    this.formLancamento.dividirPct.set(String(lanc.dividido_porcentagem ?? ''));
    this.erroFormLanc.set(null);
    this.sucessoFormLanc.set(false);
    this.mostrarFormLancamento.set(true);
  }

  fecharFormLancamento() { this.mostrarFormLancamento.set(false); }

  salvarLancamento() {
    this.erroFormLanc.set(null);

    const descricao = this.formLancamento.descricao().trim();
    if (!descricao) { this.erroFormLanc.set('Informe a descrição'); return; }

    // Calcula valor_parcela a partir do modo selecionado
    const nParcelas = parseInt(this.formLancamento.nParcelas());
    if (!nParcelas || nParcelas < 1) { this.erroFormLanc.set('Número de parcelas inválido'); return; }

    let valorParcela: number;
    if (this.modoValor() === 'total') {
      const total = parseFloat(this.formLancamento.valorTotal().replace(',', '.'));
      if (!total || total <= 0) { this.erroFormLanc.set('Informe o valor total'); return; }
      valorParcela = total / nParcelas;
    } else {
      valorParcela = parseFloat(this.formLancamento.valorParcela().replace(',', '.'));
      if (!valorParcela || valorParcela <= 0) { this.erroFormLanc.set('Informe o valor da parcela'); return; }
    }

    if (!this.formLancamento.dataCompra()) { this.erroFormLanc.set('Informe a data da compra'); return; }

    const entrada: EntradaLancamento = {
      descricao,
      valor_parcela:   Math.round(valorParcela * 100) / 100,
      parcela_inicial: 1,
      parcela_final:   nParcelas,
      data_compra:     this.formLancamento.dataCompra(),
      situacao:        this.formLancamento.situacao(),
    };

    if (this.formLancamento.dividir()) {
      if (!this.formLancamento.dividirEmail().trim()) { this.erroFormLanc.set('Informe o e-mail do parceiro'); return; }
      const pct = parseFloat(this.formLancamento.dividirPct().replace(',', '.'));
      if (!pct || pct <= 0 || pct >= 100) { this.erroFormLanc.set('Porcentagem do parceiro deve ser entre 1 e 99'); return; }
      entrada.dividido_email       = this.formLancamento.dividirEmail().trim();
      entrada.dividido_porcentagem = pct;
    }

    this.carregandoFormLanc.set(true);
    const edicao  = this.lancamentoEmEdicao();
    const cartao  = this.cartaoSelecionado();
    if (!cartao) { this.erroFormLanc.set('Selecione um cartão'); this.carregandoFormLanc.set(false); return; }

    const obs$ = edicao
      ? this.cartaoServico.editarLancamento(edicao.id, entrada)
      : this.cartaoServico.criarLancamento(cartao.id, entrada);

    obs$.subscribe({
      next: () => {
        this.carregandoFormLanc.set(false);
        this.sucessoFormLanc.set(true);
        setTimeout(() => {
          this.mostrarFormLancamento.set(false);
          this.sucessoFormLanc.set(false);
          this._carregarFatura();
        }, 1200);
      },
      error: (e: Error) => { this.erroFormLanc.set(e.message); this.carregandoFormLanc.set(false); },
    });
  }

  // ─── Modal de cartão ──────────────────────────────────────────────────────

  abrirNovoCartao() {
    this.cartaoEmEdicao.set(null);
    this._resetarFormCartao();
    this.mostrarFormCartao.set(true);
  }

  abrirEdicaoCartao(cartao: Cartao, event: Event) {
    event.stopPropagation();
    this.cartaoEmEdicao.set(cartao);
    this.formCartao.banco.set(cartao.banco);
    this.formCartao.limite.set(String(cartao.limite));
    this.formCartao.fechamento.set(String(cartao.fechamento));
    this.formCartao.vencimento.set(String(cartao.vencimento));
    this.erroFormCart.set(null);
    this.sucessoFormCart.set(false);
    this.mostrarFormCartao.set(true);
  }

  fecharFormCartao() { this.mostrarFormCartao.set(false); }

  salvarCartao() {
    this.erroFormCart.set(null);

    const banco = this.formCartao.banco().trim();
    if (!banco) { this.erroFormCart.set('Informe o banco'); return; }

    const limite = parseFloat(this.formCartao.limite().replace(',', '.'));
    if (!limite || limite <= 0) { this.erroFormCart.set('Informe um limite válido'); return; }

    const fechamento = parseInt(this.formCartao.fechamento());
    if (!fechamento || fechamento < 1 || fechamento > 31) { this.erroFormCart.set('Dia de fechamento inválido (1–31)'); return; }

    const vencimento = parseInt(this.formCartao.vencimento());
    if (!vencimento || vencimento < 1 || vencimento > 31) { this.erroFormCart.set('Dia de vencimento inválido (1–31)'); return; }

    const entrada: EntradaCartao = { banco, limite, fechamento, vencimento };

    this.carregandoFormCart.set(true);
    const edicao = this.cartaoEmEdicao();

    const obs$ = edicao
      ? this.cartaoServico.editar(edicao.id, entrada)
      : this.cartaoServico.criar(entrada);

    obs$.subscribe({
      next: (c) => {
        this.carregandoFormCart.set(false);
        this.sucessoFormCart.set(true);
        setTimeout(() => {
          this.mostrarFormCartao.set(false);
          this.sucessoFormCart.set(false);
          if (edicao) {
            this.cartoes.update(lista => lista.map(x => x.id === c.id ? c : x));
            if (this.cartaoSelecionado()?.id === c.id) this.cartaoSelecionado.set(c);
          } else {
            this.cartoes.update(lista => [...lista, c]);
            if (!this.cartaoSelecionado()) {
              this.cartaoSelecionado.set(c);
              this._carregarFatura();
            }
          }
        }, 1200);
      },
      error: (e: Error) => { this.erroFormCart.set(e.message); this.carregandoFormCart.set(false); },
    });
  }

  // ─── Helpers de template ──────────────────────────────────────────────────

  moeda(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  formatarData(iso: string): string {
    if (!iso) return '';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  formatarDataCurta(iso: string): string {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  rotuloParcela(lanc: LancamentoFatura): string {
    if (lanc.parcela_total === 1) return 'À vista';
    return `${lanc.parcela_atual}/${lanc.parcela_total}`;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private _carregarCartoes() {
    this.cartaoServico.listar().subscribe({
      next: (lista) => {
        this.cartoes.set(lista);
        if (lista.length > 0) {
          this.cartaoSelecionado.set(lista[0]);
          this._carregarFatura();
        }
      },
      error: (e: Error) => { this.erroLista.set(e.message); },
    });
  }

  private _carregarFatura() {
    const cartao = this.cartaoSelecionado();
    if (!cartao) return;

    this.carregando.set(true);
    this.erroLista.set(null);

    const mes = this.mesAtual();
    const ano = this.anoAtual();

    this.cartaoServico.listarFatura(cartao.id, mes, ano).subscribe({
      next: (lista) => {
        this.lancamentos.set(lista);
        this.carregando.set(false);
        this._recalcularResumoLocal();
      },
      error: (e: Error) => { this.erroLista.set(e.message); this.carregando.set(false); },
    });

    this.cartaoServico.resumoFatura(cartao.id, mes, ano).subscribe({
      next: (r) => this.resumo.set(r),
      error: () => {},
    });
  }

  private _recalcularResumoLocal() {
    const lista    = this.lancamentos();
    const total    = lista.reduce((s, l) => s + l.valor_parcela, 0);
    const pago     = lista.filter(l => l.situacao === 'pago').reduce((s, l) => s + l.valor_parcela, 0);
    const pendente = total - pago;
    this.resumo.set({ total, pago, pendente, quantidade: lista.length });
  }

  private _resetarFormLancamento() {
    this.modoValor.set('total');
    this.formLancamento.descricao.set('');
    this.formLancamento.valorTotal.set('');
    this.formLancamento.valorParcela.set('');
    this.formLancamento.nParcelas.set('1');
    this.formLancamento.dataCompra.set(this._dataHoje());
    this.formLancamento.situacao.set('pendente');
    this.formLancamento.dividir.set(false);
    this.formLancamento.dividirEmail.set('');
    this.formLancamento.dividirPct.set('');
    this.erroFormLanc.set(null);
    this.sucessoFormLanc.set(false);
  }

  private _resetarFormCartao() {
    this.formCartao.banco.set('');
    this.formCartao.limite.set('');
    this.formCartao.fechamento.set('');
    this.formCartao.vencimento.set('');
    this.erroFormCart.set(null);
    this.sucessoFormCart.set(false);
  }

  private _dataHoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
