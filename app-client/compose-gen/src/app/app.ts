import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { debounceTime, startWith } from 'rxjs';

type BackendId = 'node' | 'django';
type DatabaseId = 'postgres' | 'mysql' | 'mongodb';
type AdminToolId = 'adminer' | 'pgadmin';

type GenerateComposeRequest = {
  backend: BackendId;
  database: DatabaseId;
  cache: 'redis' | null;
  adminTools: AdminToolId[];
};

type GenerateComposeResponse = {
  composeYaml: string;
  envExample: string;
  warnings: string[];
};

@Component({
  selector: 'app-root',
  imports: [
    ClipboardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatListModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTabsModule,
    MatToolbarModule,
    ReactiveFormsModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly http = inject(HttpClient);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly response = signal<GenerateComposeResponse | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly isLoading = signal(false);

  protected readonly form = new FormGroup({
    backend: new FormControl<BackendId>('node', { nonNullable: true }),
    database: new FormControl<DatabaseId>('postgres', { nonNullable: true }),
    redis: new FormControl(true, { nonNullable: true }),
    adminer: new FormControl(false, { nonNullable: true }),
    pgadmin: new FormControl(true, { nonNullable: true })
  });

  protected readonly backends = [
    { id: 'node' as const, title: 'Node.js', description: 'API ou app JS com npm run dev.' },
    { id: 'django' as const, title: 'Django', description: 'Servidor Python com manage.py runserver.' }
  ];

  protected readonly databases = [
    { id: 'postgres' as const, title: 'PostgreSQL', description: 'Banco relacional padrao para apps web.' },
    { id: 'mysql' as const, title: 'MySQL', description: 'Banco relacional classico e popular.' },
    { id: 'mongodb' as const, title: 'MongoDB', description: 'Banco de documentos com volume persistente.' }
  ];

  constructor() {
    this.form.controls.database.valueChanges.pipe(takeUntilDestroyed()).subscribe((database) => {
      if (database !== 'postgres') {
        this.form.controls.pgadmin.setValue(false, { emitEvent: false });
      }

      if (database === 'mongodb') {
        this.form.controls.adminer.setValue(false, { emitEvent: false });
      }
    });

    this.form.valueChanges
      .pipe(debounceTime(250), startWith(this.form.getRawValue()), takeUntilDestroyed())
      .subscribe(() => this.generate());
  }

  protected canUseAdminer(): boolean {
    return this.form.controls.database.value !== 'mongodb';
  }

  protected canUsePgAdmin(): boolean {
    return this.form.controls.database.value === 'postgres';
  }

  protected generate(): void {
    const request = this.createRequest();
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http.post<GenerateComposeResponse>('http://localhost:3000/generate', request).subscribe({
      next: (response) => {
        this.response.set(response);
        this.isLoading.set(false);
      },
      error: (error) => {
        const message = error?.error?.message ?? 'Nao foi possivel gerar o compose agora.';
        this.errorMessage.set(message);
        this.isLoading.set(false);
      }
    });
  }

  protected copy(content: string, label: string): void {
    const copied = this.clipboard.copy(content);
    this.snackBar.open(copied ? `${label} copiado.` : `Nao foi possivel copiar ${label}.`, 'Fechar', {
      duration: 1800
    });
  }

  private createRequest(): GenerateComposeRequest {
    const value = this.form.getRawValue();
    const adminTools: AdminToolId[] = [];

    if (value.adminer && this.canUseAdminer()) {
      adminTools.push('adminer');
    }

    if (value.pgadmin && this.canUsePgAdmin()) {
      adminTools.push('pgadmin');
    }

    return {
      backend: value.backend,
      database: value.database,
      cache: value.redis ? 'redis' : null,
      adminTools
    };
  }
}
