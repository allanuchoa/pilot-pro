# Pilot Pro

Planejador web de voos fotogrametricos para drones compativeis com DJI Fly, integrado ao ecossistema Allan Workbench.
A aplicacao executa 100% no navegador com HTML5, CSS3 Vanilla e JavaScript ES6+ nativo, sem etapa de build.

## Execucao Local

Sirva a raiz do repositorio com qualquer servidor HTTP estatico simples na porta 5500.

```bash
python -m http.server 5500
```

Alternativamente, utilize o pacote `serve` via Node.js.

```bash
npx serve -l 5500
```

Acesse `http://localhost:5500/` no navegador.
A autenticacao SSO depende de sessao valida no Supabase compartilhada com o Portal configurado em [config.js](./config.js).

## Testes Automatizados

Execute a suite de verificacao da logica pura (fotogrametria, geometria, elevacao, multi-bateria e exportacao WPML/KMZ) via Node.js.

```bash
node tests/run-tests.mjs
```

## Configuracao do Banco de Dados (Supabase)

Os scripts SQL do Pilot Pro ficam em `sql/` e sao seguros para re-execucao.

1. Execute [sql/001_schema_ppr.sql](./sql/001_schema_ppr.sql) no SQL Editor do Supabase para criar as tabelas `public.ppr_missions` e `public.ppr_drone_profiles`, triggers de `updated_at` e politicas RLS.
2. Edite o placeholder de UUID em [sql/setup.sql](./sql/setup.sql) e execute o script para registrar o slug `pilot-pro` em `public.applications` e liberar o acesso em `public.user_applications`.

## Documentacao do Projeto

* [ARCHITECTURE.md](./ARCHITECTURE.md): arquitetura tecnica, integracao SSO/App Bridge e modelo de dados.
* [PRD.md](./PRD.md): requisitos funcionais, catalogo de aeronaves e criterios de aceitacao do MVP.
* [TASKS.md](./TASKS.md): backlog executavel de implementacao por fases.
* [AGENTS.md](./AGENTS.md): regras tecnicas, formulas obrigatorias e contrato de seguranca.
* [docs/CHANGELOG.md](./docs/CHANGELOG.md): historico de versoes e mudancas.
