import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { debounceTime } from 'rxjs';

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

type SavedStack = {
  id: string;
  name: string;
  backend: BackendId;
  database: DatabaseId;
  cache: 'redis' | null;
  adminTools: AdminToolId[];
  composeYaml: string;
  envExample: string;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
};

type SaveStackResponse = {
  stack: SavedStack;
  generated: GenerateComposeResponse;
};

@Component({
  selector: 'app-root',
  imports: [
    ClipboardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTabsModule,
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
  protected readonly savedStacks = signal<SavedStack[]>([]);
  protected readonly errorMessage = signal('');
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isLoadingStacks = signal(false);

  protected readonly form = new FormGroup({
    stackName: new FormControl('Minha stack base', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
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
    this.form.controls.database.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.normalizeSelections();
    });

    this.form.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => {
      this.errorMessage.set('');
      this.generate();
    });

    this.generate();
    this.loadStacks();
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

  protected saveStack(): void {
    if (this.form.controls.stackName.invalid) {
      this.form.controls.stackName.markAsTouched();
      this.snackBar.open('Defina um nome curto para salvar a stack.', 'Fechar', { duration: 2200 });
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');

    const payload = {
      name: this.form.controls.stackName.getRawValue(),
      ...this.createRequest()
    };

    this.http.post<SaveStackResponse>('http://localhost:3000/stacks', payload).subscribe({
      next: (result) => {
        this.response.set(result.generated);
        this.isSaving.set(false);
        this.snackBar.open('Stack salva no Prisma.', 'Fechar', { duration: 2000 });
        this.loadStacks();
      },
      error: (error) => {
        const message = error?.error?.message ?? 'Nao foi possivel salvar a stack agora.';
        this.errorMessage.set(message);
        this.isSaving.set(false);
      }
    });
  }

  protected applyStack(stack: SavedStack): void {
    this.form.patchValue(
      {
        stackName: stack.name,
        backend: stack.backend,
        database: stack.database,
        redis: stack.cache === 'redis',
        adminer: stack.adminTools.includes('adminer'),
        pgadmin: stack.adminTools.includes('pgadmin')
      },
      { emitEvent: false }
    );

    this.normalizeSelections();
    this.generate();
  }

  protected copy(content: string, label: string): void {
    const copied = this.clipboard.copy(content);
    this.snackBar.open(copied ? `${label} copiado.` : `Nao foi possivel copiar ${label}.`, 'Fechar', {
      duration: 1800
    });
  }

  private loadStacks(): void {
    this.isLoadingStacks.set(true);

    this.http.get<SavedStack[]>('http://localhost:3000/stacks').subscribe({
      next: (stacks) => {
        this.savedStacks.set(stacks);
        this.isLoadingStacks.set(false);
      },
      error: () => {
        this.savedStacks.set([]);
        this.isLoadingStacks.set(false);
      }
    });
  }

  private normalizeSelections(): void {
    if (!this.canUsePgAdmin() && this.form.controls.pgadmin.value) {
      this.form.controls.pgadmin.setValue(false, { emitEvent: false });
    }

    if (!this.canUseAdminer() && this.form.controls.adminer.value) {
      this.form.controls.adminer.setValue(false, { emitEvent: false });
    }
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
