/**
 * ConquistasComponent — Página de metas de poupança.
 *
 * Funcionalidades:
 *   - Grid de cards com barra de progresso
 *   - Modal para criar/editar meta
 *   - Modal de detalhe: histórico de aportes + registrar novo aporte
 *   - Arquivar (soft delete) ou remover permanentemente
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConquistaService } from '../../core/servicos/conquista.service';
import { Conquista, Aporte, EntradaConquista, EntradaAporte } from '../../core/modelos/conquista';

@Component({
  selector: 'app-conquistas',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './conquistas.component.html',
  styleUrl: './conquistas.component.scss',
})
export class ConquistasComponent implements OnInit {

  private conquistaServico = inject(ConquistaService);

  // ─── Estado ───────────────────────────────────────────────────────────────

  conquistas    = signal<Conquista[]>([]);
  carregando    = signal(false);
  erroLista     = signal<string | null>(null);

  // ─── Modal de conquista (criar/editar) ────────────────────────────────────

  mostrarFormConquista = signal(false);
  conquistaEmEdicao    = signal<Conquista | null>(null);
  carregandoForm       = signal(false);
  erroForm             = signal<string | null>(null);
  sucessoForm          = signal(false);

  formConquista = {
    nome:      signal(''),
    descricao: signal(''),
    meta:      signal(''),
    prazo:     signal(''),
    emoji:     signal(''),
  };

  // ─── Modal de detalhe / aportes ───────────────────────────────────────────

  /** Conquista aberta no painel de detalhe */
  conquistaAberta = signal<Conquista | null>(null);

  /** true = exibindo formulário de novo aporte dentro do detalhe */
  modoAporte         = signal(false);
  carregandoAporte   = signal(false);
  erroAporte         = signal<string | null>(null);

  formAporte = {
    valor:     signal(''),
    data:      signal(this._dataHoje()),
    descricao: signal(''),
  };

  // ─── Exclusão da conquista ────────────────────────────────────────────────

  idParaRemover  = signal<number | null>(null);
  removendo      = signal(false);

  // ─── Computed ─────────────────────────────────────────────────────────────

  /** Conquistas ordenadas: menor % de progresso primeiro (mais urgente) */
  conquistasOrdenadas = computed(() =>
    [...this.conquistas()].sort((a, b) => this.progresso(a) - this.progresso(b))
  );

  /** Total acumulado em todas as conquistas ativas */
  totalAcumulado = computed(() =>
    this.conquistas().reduce((s, c) => s + c.acumulado, 0)
  );

  /** Total de metas somadas */
  totalMeta = computed(() =>
    this.conquistas().reduce((s, c) => s + c.meta, 0)
  );

  /** % de progresso geral (0–100) — evita Math.min() direto no template */
  progressoTotal = computed(() => {
    const meta = this.totalMeta();
    if (meta <= 0) return 0;
    return Math.min(100, Math.round((this.totalAcumulado() / meta) * 100));
  });

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() { this._carregar(); }

  // ─── Formulário de conquista ──────────────────────────────────────────────

  abrirNovaConquista() {
    this.conquistaEmEdicao.set(null);
    this._resetarFormConquista();
    this.mostrarFormConquista.set(true);
  }

  abrirEdicaoConquista(c: Conquista) {
    this.conquistaEmEdicao.set(c);
    this.formConquista.nome.set(c.nome);
    this.formConquista.descricao.set(c.descricao ?? '');
    this.formConquista.meta.set(String(c.meta));
    this.formConquista.prazo.set(c.prazo);
    this.formConquista.emoji.set(c.emoji ?? '');
    this.erroForm.set(null);
    this.sucessoForm.set(false);
    this.mostrarFormConquista.set(true);
  }

  fecharFormConquista() { this.mostrarFormConquista.set(false); }

  salvarConquista() {
    this.erroForm.set(null);

    if (!this.formConquista.nome().trim()) { this.erroForm.set('Informe o nome do objetivo'); return; }
    const metaNum = parseFloat(this.formConquista.meta().replace(',', '.'));
    if (!metaNum || metaNum <= 0)           { this.erroForm.set('Informe uma meta válida'); return; }
    if (!this.formConquista.prazo())        { this.erroForm.set('Informe o prazo'); return; }

    const entrada: EntradaConquista = {
      nome:      this.formConquista.nome().trim(),
      descricao: this.formConquista.descricao().trim() || undefined,
      meta:      metaNum,
      prazo:     this.formConquista.prazo(),
      emoji:     this.formConquista.emoji().trim() || undefined,
    };

    this.carregandoForm.set(true);
    const edicao = this.conquistaEmEdicao();

    const obs$ = edicao
      ? this.conquistaServico.editar(edicao.id, entrada)
      : this.conquistaServico.criar(entrada);

    obs$.subscribe({
      next: () => {
        this.carregandoForm.set(false);
        this.sucessoForm.set(true);
        setTimeout(() => {
          this.mostrarFormConquista.set(false);
          this.sucessoForm.set(false);
          this._carregar();
        }, 1200);
      },
      error: (e: Error) => { this.erroForm.set(e.message); this.carregandoForm.set(false); },
    });
  }

  // ─── Detalhe da conquista ─────────────────────────────────────────────────

  abrirDetalhe(c: Conquista) {
    this.conquistaAberta.set(c);
    this.modoAporte.set(false);
    this._resetarFormAporte();
  }

  fecharDetalhe() {
    this.conquistaAberta.set(null);
    this.modoAporte.set(false);
  }

  // ─── Aportes ──────────────────────────────────────────────────────────────

  iniciarAporte() {
    this._resetarFormAporte();
    this.modoAporte.set(true);
  }

  cancelarAporte() { this.modoAporte.set(false); }

  salvarAporte() {
    this.erroAporte.set(null);
    const c = this.conquistaAberta();
    if (!c) return;

    const valorNum = parseFloat(this.formAporte.valor().replace(',', '.'));
    if (!valorNum || valorNum <= 0) { this.erroAporte.set('Informe um valor válido'); return; }
    if (!this.formAporte.data())    { this.erroAporte.set('Informe a data'); return; }

    const entrada: EntradaAporte = {
      valor:     valorNum,
      data:      this.formAporte.data(),
      descricao: this.formAporte.descricao().trim() || undefined,
    };

    this.carregandoAporte.set(true);

    this.conquistaServico.registrarAporte(c.id, entrada).subscribe({
      next: (atualizada) => {
        // Atualiza o card na lista e o painel de detalhe
        this.conquistas.update(lista => lista.map(x => x.id === atualizada.id ? atualizada : x));
        this.conquistaAberta.set(atualizada);
        this.modoAporte.set(false);
        this.carregandoAporte.set(false);
        this._resetarFormAporte();
      },
      error: (e: Error) => { this.erroAporte.set(e.message); this.carregandoAporte.set(false); },
    });
  }

  removerAporte(aporte: Aporte) {
    const c = this.conquistaAberta();
    if (!c) return;

    this.conquistaServico.removerAporte(c.id, aporte.id).subscribe({
      next: () => {
        // Remove localmente e recalcula acumulado
        const aportes = c.aportes.filter(a => a.id !== aporte.id);
        const acumulado = aportes.reduce((s, a) => s + a.valor, 0);
        const atualizada = { ...c, aportes, acumulado };
        this.conquistaAberta.set(atualizada);
        this.conquistas.update(lista => lista.map(x => x.id === atualizada.id ? atualizada : x));
      },
      error: () => {},
    });
  }

  // ─── Remoção da conquista ─────────────────────────────────────────────────

  confirmarRemocao(id: number, event: Event) {
    event.stopPropagation(); // não abre o detalhe
    this.idParaRemover.set(id);
  }

  cancelarRemocao() { this.idParaRemover.set(null); }

  remover() {
    const id = this.idParaRemover();
    if (!id) return;
    this.removendo.set(true);
    this.conquistaServico.remover(id).subscribe({
      next: () => {
        this.conquistas.update(lista => lista.filter(c => c.id !== id));
        this.idParaRemover.set(null);
        this.removendo.set(false);
        if (this.conquistaAberta()?.id === id) this.fecharDetalhe();
      },
      error: () => { this.removendo.set(false); this.idParaRemover.set(null); },
    });
  }

  // ─── Helpers de template ──────────────────────────────────────────────────

  /** % de progresso da conquista (0–100) */
  progresso(c: Conquista): number {
    return Math.min(100, Math.round((c.acumulado / c.meta) * 100));
  }

  /** Faltam R$ X para completar */
  faltante(c: Conquista): number { return Math.max(0, c.meta - c.acumulado); }

  /** Cor da barra de progresso conforme nível de progresso */
  corBarra(c: Conquista): string {
    const pct = c.acumulado / c.meta;
    if (pct >= 1)   return 'var(--color-mint)';   // concluído
    if (pct >= 0.8) return 'var(--color-gold)';   // quase lá
    if (pct < 0.3)  return 'var(--color-coral)';  // atenção
    return 'var(--color-mint)';
  }

  /** Cor de fundo semântica do card */
  fundoCard(c: Conquista): string {
    const pct = c.acumulado / c.meta;
    if (pct >= 1)   return 'rgba(167, 252, 205, 0.25)'; // concluído — Mint
    if (pct >= 0.8) return 'rgba(236, 218, 152, 0.18)'; // Gold
    if (pct < 0.3)  return 'rgba(255, 148, 115, 0.08)'; // Coral
    return '#fff';
  }

  /** Dias restantes para o prazo */
  diasRestantes(c: Conquista): number {
    const hoje = new Date();
    const prazo = new Date(c.prazo + 'T00:00:00');
    return Math.ceil((prazo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  }

  /** Rótulo do prazo */
  rotuloPrazo(c: Conquista): string {
    const dias = this.diasRestantes(c);
    if (dias < 0)  return 'prazo encerrado';
    if (dias === 0) return 'vence hoje';
    if (dias === 1) return 'vence amanhã';
    if (dias <= 30) return `${dias} dias`;
    const meses = Math.round(dias / 30);
    return `${meses} mês${meses > 1 ? 'es' : ''}`;
  }

  moeda(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  formatarData(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  formatarDataCurta(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private _carregar() {
    this.carregando.set(true);
    this.conquistaServico.listar().subscribe({
      next: (lista) => { this.conquistas.set(lista); this.carregando.set(false); },
      error: (e: Error) => { this.erroLista.set(e.message); this.carregando.set(false); },
    });
  }

  private _resetarFormConquista() {
    this.formConquista.nome.set('');
    this.formConquista.descricao.set('');
    this.formConquista.meta.set('');
    this.formConquista.prazo.set('');
    this.formConquista.emoji.set('');
    this.erroForm.set(null);
    this.sucessoForm.set(false);
  }

  private _resetarFormAporte() {
    this.formAporte.valor.set('');
    this.formAporte.data.set(this._dataHoje());
    this.formAporte.descricao.set('');
    this.erroAporte.set(null);
  }

  private _dataHoje(): string {
    return new Date().toISOString().split('T')[0];
  }
}
