import cors from 'cors';
import express from 'express';
import { stringify } from 'yaml';
import { z } from 'zod';

const generateComposeSchema = z
  .object({
    backend: z.enum(['node', 'django']),
    database: z.enum(['postgres', 'mysql', 'mongodb']),
    cache: z.enum(['redis']).nullable().optional(),
    adminTools: z.array(z.enum(['adminer', 'pgadmin'])).default([])
  })
  .superRefine((value, context) => {
    if (value.adminTools.includes('pgadmin') && value.database !== 'postgres') {
      context.addIssue({
        code: 'custom',
        path: ['adminTools'],
        message: 'pgAdmin so pode ser usado com PostgreSQL.'
      });
    }

    if (value.adminTools.includes('adminer') && !['postgres', 'mysql'].includes(value.database)) {
      context.addIssue({
        code: 'custom',
        path: ['adminTools'],
        message: 'Adminer so pode ser usado com PostgreSQL ou MySQL.'
      });
    }
  });

type GenerateComposeRequest = z.infer<typeof generateComposeSchema>;

type ComposeService = {
  image?: string;
  build?: string;
  working_dir?: string;
  command?: string;
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  depends_on?: string[];
  networks?: string[];
};

type ComposeDocument = {
  services: Record<string, ComposeService>;
  volumes?: Record<string, null>;
  networks: Record<string, { driver: string }>;
};

const networkName = 'app_network';

function withNetwork(service: ComposeService): ComposeService {
  return { ...service, networks: [networkName] };
}

function createBackendService(request: GenerateComposeRequest): ComposeService {
  const depends_on = ['db'];
  if (request.cache === 'redis') {
    depends_on.push('redis');
  }

  if (request.backend === 'django') {
    return withNetwork({
      build: '.',
      command: 'python manage.py runserver 0.0.0.0:8000',
      ports: ['8000:8000'],
      environment: {
        DATABASE_HOST: 'db',
        DATABASE_NAME: '${DATABASE_NAME}',
        DATABASE_USER: '${DATABASE_USER}',
        DATABASE_PASSWORD: '${DATABASE_PASSWORD}',
        REDIS_URL: request.cache === 'redis' ? 'redis://redis:6379/0' : ''
      },
      depends_on
    });
  }

  return withNetwork({
    build: '.',
    working_dir: '/app',
    command: 'npm run dev',
    ports: ['3000:3000'],
    volumes: ['./:/app'],
    environment: {
      DATABASE_HOST: 'db',
      DATABASE_NAME: '${DATABASE_NAME}',
      DATABASE_USER: '${DATABASE_USER}',
      DATABASE_PASSWORD: '${DATABASE_PASSWORD}',
      REDIS_URL: request.cache === 'redis' ? 'redis://redis:6379' : ''
    },
    depends_on
  });
}

function createDatabaseService(database: GenerateComposeRequest['database']): {
  service: ComposeService;
  volumeName: string;
  env: Record<string, string>;
} {
  if (database === 'mysql') {
    return {
      volumeName: 'mysql_data',
      service: withNetwork({
        image: 'mysql:8.4',
        ports: ['3306:3306'],
        environment: {
          MYSQL_DATABASE: '${DATABASE_NAME}',
          MYSQL_USER: '${DATABASE_USER}',
          MYSQL_PASSWORD: '${DATABASE_PASSWORD}',
          MYSQL_ROOT_PASSWORD: '${MYSQL_ROOT_PASSWORD}'
        },
        volumes: ['mysql_data:/var/lib/mysql']
      }),
      env: {
        DATABASE_NAME: 'app',
        DATABASE_USER: 'app',
        DATABASE_PASSWORD: 'app',
        MYSQL_ROOT_PASSWORD: 'root'
      }
    };
  }

  if (database === 'mongodb') {
    return {
      volumeName: 'mongodb_data',
      service: withNetwork({
        image: 'mongo:7',
        ports: ['27017:27017'],
        environment: {
          MONGO_INITDB_ROOT_USERNAME: '${DATABASE_USER}',
          MONGO_INITDB_ROOT_PASSWORD: '${DATABASE_PASSWORD}',
          MONGO_INITDB_DATABASE: '${DATABASE_NAME}'
        },
        volumes: ['mongodb_data:/data/db']
      }),
      env: {
        DATABASE_NAME: 'app',
        DATABASE_USER: 'app',
        DATABASE_PASSWORD: 'app'
      }
    };
  }

  return {
    volumeName: 'postgres_data',
    service: withNetwork({
      image: 'postgres:16',
      ports: ['5432:5432'],
      environment: {
        POSTGRES_DB: '${DATABASE_NAME}',
        POSTGRES_USER: '${DATABASE_USER}',
        POSTGRES_PASSWORD: '${DATABASE_PASSWORD}'
      },
      volumes: ['postgres_data:/var/lib/postgresql/data']
    }),
    env: {
      DATABASE_NAME: 'app',
      DATABASE_USER: 'app',
      DATABASE_PASSWORD: 'app'
    }
  };
}

function createEnvExample(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function generateCompose(request: GenerateComposeRequest) {
  const database = createDatabaseService(request.database);
  const services: ComposeDocument['services'] = {
    app: createBackendService(request),
    db: database.service
  };
  const volumes: Record<string, null> = {
    [database.volumeName]: null
  };
  const env = { ...database.env };
  const warnings: string[] = [];

  if (request.cache === 'redis') {
    services.redis = withNetwork({
      image: 'redis:7-alpine',
      ports: ['6379:6379'],
      volumes: ['redis_data:/data']
    });
    volumes.redis_data = null;
  }

  if (request.adminTools.includes('adminer')) {
    services.adminer = withNetwork({
      image: 'adminer:latest',
      ports: ['8080:8080'],
      depends_on: ['db']
    });
  }

  if (request.adminTools.includes('pgadmin')) {
    services.pgadmin = withNetwork({
      image: 'dpage/pgadmin4:latest',
      ports: ['5050:80'],
      environment: {
        PGADMIN_DEFAULT_EMAIL: '${PGADMIN_DEFAULT_EMAIL}',
        PGADMIN_DEFAULT_PASSWORD: '${PGADMIN_DEFAULT_PASSWORD}'
      },
      depends_on: ['db']
    });
    env.PGADMIN_DEFAULT_EMAIL = 'admin@example.com';
    env.PGADMIN_DEFAULT_PASSWORD = 'admin';
    warnings.push('No pgAdmin, conecte usando host "db" e porta interna 5432.');
  }

  if (request.database === 'mongodb') {
    warnings.push('MongoDB usa usuario root inicial; ajuste a connection string da aplicacao conforme seu driver.');
  }

  const compose: ComposeDocument = {
    services,
    volumes,
    networks: {
      [networkName]: {
        driver: 'bridge'
      }
    }
  };

  return {
    composeYaml: stringify(compose, { indent: 2 }),
    envExample: createEnvExample(env),
    warnings
  };
}

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors({ origin: ['http://localhost:4200'] }));
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/generate', (request, response) => {
  const parsed = generateComposeSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      message: 'Configuracao invalida.',
      issues: parsed.error.issues
    });
  }

  return response.json(generateCompose(parsed.data));
});

app.listen(port, () => {
  console.log(`Compose generator API running on http://localhost:${port}`);
});
