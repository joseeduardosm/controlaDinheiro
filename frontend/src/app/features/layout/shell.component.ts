/**
 * ShellComponent — invólucro de layout para todas as páginas autenticadas.
 * Renderiza a topbar, verifica pendências de aprovação e exibe o modal bloqueante.
 */
import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AutenticacaoService } from '../../core/servicos/autenticacao.service';
import { DespesaService }      from '../../core/servicos/despesa.service';
import { CartaoService }       from '../../core/servicos/cartao.service';
import { ModalAprovacaoComponent } from '../shared/modal-aprovacao/modal-aprovacao.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ModalAprovacaoComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent implements OnInit {

  protected auth         = inject(AutenticacaoService);
  private despesaServico = inject(DespesaService);
  private cartaoServico  = inject(CartaoService);

  /** Controla a visibilidade do modal bloqueante de aprovação. */
  protected mostrarModal = signal(false);

  ngOnInit() {
    // Aguarda a sessão ser inicializada antes de verificar pendências.
    setTimeout(() => {
      if (this.auth.estaAutenticado()) {
        this._verificarPendencias();
      }
    }, 300);
  }

  /** Busca pendências (despesas + cartões) e abre o modal se houver alguma. */
  private _verificarPendencias() {
    forkJoin({
      despesas: this.despesaServico.carregarPendentes(),
      cartoes:  this.cartaoServico.carregarPendentes(),
    }).subscribe({
      next: ({ despesas, cartoes }) => {
        if (despesas.length > 0 || cartoes.length > 0) {
          this.mostrarModal.set(true);
        }
      },
      error: () => {
        // Falha silenciosa — não bloqueia o app se a checagem falhar
      },
    });
  }

  /** Chamado quando o modal emite (concluido) — todas as pendências respondidas. */
  protected aoModalConcluir() {
    this.mostrarModal.set(false);
  }
}
