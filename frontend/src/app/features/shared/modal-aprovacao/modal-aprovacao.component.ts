/**
 * ModalAprovacaoComponent — Modal bloqueante de aprovação de pendências compartilhadas.
 *
 * Exibido pelo ShellComponent quando há despesas ou lançamentos de cartão
 * aguardando resposta do usuário. O modal não pode ser fechado até que
 * todas as pendências sejam respondidas.
 *
 * Tipos tratados:
 *   - 'despesa'  → DespesaDivisao aguardando (criada por outro usuário)
 *   - 'cartao'   → CartaoLancamento.dividido aguardando (lançamento compartilhado)
 */

import { Component, inject, signal, computed, output, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DespesaService } from '../../../core/servicos/despesa.service';
import { CartaoService }  from '../../../core/servicos/cartao.service';
import { DespesaPendente, ROTULOS_RECORRENCIA } from '../../../core/modelos/despesa';
import { CartaoLancamentoPendente } from '../../../core/modelos/cartao';

/** Item unificado — pode ser de despesa ou de cartão. */
export type ItemPendente =
  | { tipo: 'despesa'; dados: DespesaPendente }
  | { tipo: 'cartao';  dados: CartaoLancamentoPendente };

@Component({
  selector: 'app-modal-aprovacao',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './modal-aprovacao.component.html',
  styleUrl: './modal-aprovacao.component.scss',
})
export class ModalAprovacaoComponent implements OnInit {

  private despesaServico = inject(DespesaService);
  private cartaoServico  = inject(CartaoService);

  /** Emitido quando todas as pendências foram respondidas. */
  concluido = output<void>();

  // ─── Estado ─────────────────────────────────────────────────────────────────

  /** Índice do item sendo exibido no momento. */
  indiceAtual = signal(0);

  /** true = usuário clicou "Negar" e o campo de justificativa está visível. */
  modoNegar = signal(false);

  /** Texto de justificativa para negar. */
  justificativa = signal('');

  /** true = aguardando resposta da API. */
  carregando = signal(false);

  /** Mensagem de erro da API. */
  erro = signal<string | null>(null);

  // ─── Computed ───────────────────────────────────────────────────────────────

  /**
   * Lista unificada de itens pendentes (despesas + cartões).
   * Despesas aparecem primeiro.
   */
  itensPendentes = computed<ItemPendente[]>(() => [
    ...this.despesaServico.pendentes().map(d => ({ tipo: 'despesa' as const, dados: d })),
    ...this.cartaoServico.pendentes().map(c => ({ tipo: 'cartao' as const, dados: c })),
  ]);

  /** Item atualmente em exibição. */
  itemAtual = computed<ItemPendente | null>(() => {
    const lista = this.itensPendentes();
    return lista.length > 0 ? lista[this.indiceAtual()] : null;
  });

  /** Total de pendências. */
  total = computed(() => this.itensPendentes().length);

  /** Número de ordem do item atual (1-based). */
  posicao = computed(() => this.indiceAtual() + 1);

  // ─── Ciclo de vida ──────────────────────────────────────────────────────────

  ngOnInit() {
    this.indiceAtual.set(0);
  }

  // ─── Ações ──────────────────────────────────────────────────────────────────

  /** Usuário clica "DE ACORDO". */
  deAcordo() {
    const item = this.itemAtual();
    if (!item || this.carregando()) return;

    this.erro.set(null);
    this.carregando.set(true);

    if (item.tipo === 'despesa') {
      // Aceitar despesa compartilhada
      this.despesaServico
        .responder(item.dados.divisao_id, { resposta: 'de_acordo' })
        .subscribe({
          next: () => this._aposResponder(),
          error: (e: Error) => { this.erro.set(e.message); this.carregando.set(false); },
        });
    } else {
      // Aceitar lançamento de cartão compartilhado
      this.cartaoServico
        .responder(item.dados.lancamento_id, { resposta: 'de_acordo' })
        .subscribe({
          next: () => this._aposResponder(),
          error: (e: Error) => { this.erro.set(e.message); this.carregando.set(false); },
        });
    }
  }

  /** Usuário clica "Negar" — abre o campo de justificativa. */
  iniciarNegacao() {
    this.modoNegar.set(true);
    this.justificativa.set('');
    this.erro.set(null);
  }

  /** Usuário confirma a negação com justificativa. */
  confirmarNegacao() {
    const item = this.itemAtual();
    if (!item || this.carregando()) return;

    if (!this.justificativa().trim()) {
      this.erro.set('Informe o motivo da recusa para prosseguir');
      return;
    }

    this.erro.set(null);
    this.carregando.set(true);

    const payload = { resposta: 'negado' as const, justificativa: this.justificativa().trim() };

    if (item.tipo === 'despesa') {
      this.despesaServico
        .responder(item.dados.divisao_id, payload)
        .subscribe({
          next: () => this._aposResponder(),
          error: (e: Error) => { this.erro.set(e.message); this.carregando.set(false); },
        });
    } else {
      this.cartaoServico
        .responder(item.dados.lancamento_id, payload)
        .subscribe({
          next: () => this._aposResponder(),
          error: (e: Error) => { this.erro.set(e.message); this.carregando.set(false); },
        });
    }
  }

  /** Cancela o modo de negação e volta a mostrar os botões normais. */
  cancelarNegacao() {
    this.modoNegar.set(false);
    this.justificativa.set('');
    this.erro.set(null);
  }

  // ─── Helpers de template ────────────────────────────────────────────────────

  /** Rótulo legível da recorrência. */
  rotuloRecorrencia(tipo: string): string {
    return ROTULOS_RECORRENCIA[tipo as keyof typeof ROTULOS_RECORRENCIA] ?? tipo;
  }

  /** Formata valor como moeda brasileira. */
  moeda(valor: number): string {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Formata data "YYYY-MM-DD" para "DD/MM/YYYY". */
  formatarData(dataIso: string): string {
    if (!dataIso) return '';
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  // ─── Interno ────────────────────────────────────────────────────────────────

  private _aposResponder() {
    this.carregando.set(false);
    this.modoNegar.set(false);
    this.justificativa.set('');
    this.erro.set(null);

    if (this.itensPendentes().length === 0) {
      this.concluido.emit();
    }
    if (this.indiceAtual() >= this.itensPendentes().length && this.itensPendentes().length > 0) {
      this.indiceAtual.set(this.itensPendentes().length - 1);
    }
  }
}
