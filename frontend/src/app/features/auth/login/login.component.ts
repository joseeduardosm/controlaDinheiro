/**
 * LoginComponent — Tela de autenticação do elo.
 *
 * Modos:
 *   'login'   — e-mail + senha para usuários existentes
 *   'cadastro' — nome + e-mail + senha para novos usuários
 *
 * Ao enviar com sucesso, o AutenticacaoService salva o token e
 * redireciona para o dashboard (rota /dashboard — a implementar).
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';

import { AutenticacaoService } from '../../../core/servicos/autenticacao.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {

  // ─── Dependências ──────────────────────────────────────────────────────────

  private construtorFormulario = inject(FormBuilder);
  private authServico          = inject(AutenticacaoService);
  private roteador             = inject(Router);

  // ─── Estado reativo ────────────────────────────────────────────────────────

  /** Alterna entre os formulários de login e cadastro */
  modo = signal<'login' | 'cadastro'>('login');

  /** Controla visibilidade do campo de senha */
  mostrarSenha = signal(false);

  /** Exibe o spinner e desabilita o botão enquanto aguarda a API */
  carregando = signal(false);

  /** Mensagem de erro retornada pela API (e-mail já cadastrado, senha errada etc.) */
  erroApi = signal<string | null>(null);

  // ─── Formulários reativos ──────────────────────────────────────────────────

  formularioLogin = this.construtorFormulario.group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(4)]],
  });

  formularioCadastro = this.construtorFormulario.group({
    nome:  ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(4)]],
  });

  // ─── Getters ───────────────────────────────────────────────────────────────

  get ehLogin() { return this.modo() === 'login'; }

  // ─── Métodos ───────────────────────────────────────────────────────────────

  alternarModo() {
    this.modo.update((m) => (m === 'login' ? 'cadastro' : 'login'));
    this.erroApi.set(null); // limpa erro ao trocar de modo
  }

  alternarVisibilidadeSenha() {
    this.mostrarSenha.update((v) => !v);
  }

  /**
   * Retorna a mensagem de erro de um campo específico após interação.
   * Erros só aparecem depois que o usuário tocou no campo (dirty).
   */
  erroCampo(formulario: 'login' | 'cadastro', campo: string): string | null {
    const form: FormGroup = formulario === 'login'
      ? this.formularioLogin
      : this.formularioCadastro;

    const controle = form.controls[campo];
    if (!controle || !controle.dirty || !controle.invalid) return null;

    if (controle.hasError('required'))  return 'Campo obrigatório';
    if (controle.hasError('email'))     return 'E-mail inválido';
    if (controle.hasError('minlength')) {
      const minimo = controle.errors?.['minlength']?.requiredLength;
      return `Mínimo de ${minimo} caracteres`;
    }
    return null;
  }

  /**
   * Submete o formulário ativo.
   * Em caso de sucesso redireciona para /dashboard.
   * Em caso de erro da API exibe a mensagem retornada pelo backend.
   */
  aoEnviar() {
    this.erroApi.set(null);

    if (this.ehLogin) {
      this.formularioLogin.markAllAsTouched();
      if (!this.formularioLogin.valid) return;

      this.carregando.set(true);
      const { email, senha } = this.formularioLogin.value;

      this.authServico.entrar({ email: email!, senha: senha! }).subscribe({
        next: () => this.roteador.navigate(['/dashboard']),
        error: (erro: Error) => {
          this.erroApi.set(erro.message);
          this.carregando.set(false);
        },
      });

    } else {
      this.formularioCadastro.markAllAsTouched();
      if (!this.formularioCadastro.valid) return;

      this.carregando.set(true);
      const { nome, email, senha } = this.formularioCadastro.value;

      this.authServico.cadastrar({ nome: nome!, email: email!, senha: senha! }).subscribe({
        next: () => this.roteador.navigate(['/dashboard']),
        error: (erro: Error) => {
          this.erroApi.set(erro.message);
          this.carregando.set(false);
        },
      });
    }
  }
}
