# Product Requirements Document (PRD) - Pilot Pro

Este documento especifica os requisitos funcionais, regras de calculo, modelo de dados, esbocos de tela e criterios de aceitacao para a ferramenta **Pilot Pro** (`pilot-pro`) do ecossistema **Allan Workbench**.

---

## 1. Contexto e Objetivos

O **Pilot Pro** tem como objetivo gerar planos de voo fotogrametricos precisos e exporta-los no formato `.kmz` (WPML) compativel com o aplicativo **DJI Fly**.
A ferramenta elimina planilhas externas para calculo de espacamento entre linhas e temporizacao de disparos, incorporando alinhamento reto de trajetorias (`Straighten Flight Path`), acompanhamento de terreno (`Terrain Follow`) e divisao automatica por bateria em uma interface web escura integrada ao Allan Workbench.

### Metadados de Registro no Ecossistema

| Campo | Valor |
|---|---|
| Nome de exibicao | Pilot Pro |
| Slug | `pilot-pro` |
| Prefixo SQL | `ppr_` |
| Repositorio Git | `pilot-pro` |
| URL de producao | `https://allanuchoa.github.io/pilot-pro/` |
| Categoria no Portal | `Engineering` |
| Icone Lucide | `map` |

---

## 2. Catalogo Inicial de Aeronaves (MVP)

Todos os modelos abaixo operam em modo foto 4:3 (12 MP ou 20 MP) na camera grande-angular principal, que e o padrao recomendado para fotogrametria.
Os valores de autonomia util ja descontam margem conservadora de seguranca para decolagem, retorno (RTH) e vento moderado.

| Chave (`drone_key`) | Modelo | Sensor (mm) | Focal real (mm) | Resolucao (px) | Obturador | Velocidade segura padrao | Autonomia util padrao |
|---|---|---|---|---|---|---|---|
| `dji-mini-4-pro` | DJI Mini 4 Pro | 9.60 x 7.20 | 6.72 | 4032 x 3024 | Eletronico | 9.0 m/s | 22 min |
| `dji-mini-3-pro` | DJI Mini 3 / 3 Pro | 9.60 x 7.20 | 6.72 | 4032 x 3024 | Eletronico | 9.0 m/s | 22 min |
| `dji-air-3` | DJI Air 3 (Wide) | 9.60 x 7.20 | 6.72 | 4032 x 3024 | Eletronico | 9.5 m/s | 30 min |
| `dji-air-3s` | DJI Air 3S (Wide) | 13.13 x 9.85 | 8.75 | 4000 x 3000 | Eletronico | 9.5 m/s | 30 min |
| `dji-mavic-3` | DJI Mavic 3 / Classic / Pro (Wide) | 17.30 x 13.00 | 12.29 | 5280 x 3956 | Eletronico | 10.0 m/s | 30 min |
| `custom` | Perfil Customizado | Editavel | Editavel | Editavel | Selecionavel | Editavel | Editavel |

*Nota de validacao*: para `dji-mini-4-pro` a 100 m AGL com 65% de sobreposicao lateral, a largura coberta no solo e `100 * (9.60 / 6.72) = 142.86 m`, resultando em espacamento exato de `142.86 * (1 - 0.65) = 50.0 m`.

---

## 3. Requisitos Funcionais (MVP)

### RF01: Integracao SSO e App Bridge
* **Descricao**: a ferramenta deve iniciar autenticada exclusivamente via SSO nativo do Supabase e carregar o cabecalho compartilhado via `workbench-bridge.js`.
* **Regras**:
  * O `<body>` permanece oculto ate o evento `workbench-ready`.
  * A aplicacao escuta `onAuthStateChange` e redireciona imediatamente para `CONFIG.PORTAL_URL` ao detectar `SIGNED_OUT`.
  * Qualquer redirecionamento baseado em URL valida o padrao `^https?://`.

### RF02: Mapa Interativo e Camadas
* **Descricao**: exibir mapa em tela cheia (descontando o header do App Bridge) com imagens de satelite de alta resolucao e alternancia de camada base.
* **Regras**:
  * Camada padrao: Esri World Imagery (satelite gratuito sem obrigatoriedade de chave).
  * Camadas alternativas: Carto Dark Matter e OpenStreetMap.
  * Suporte opcional em `config.js` para camada extra de satelite por chave gratuita (ex: MapTiler) se configurada.
  * Controles rapidos: centralizar na geolocalizacao atual do usuario, ir para coordenadas (lat, lon) e zoom.

### RF03: Definicao de Area e Ponto de Decolagem
* **Descricao**: permitir delimitar a area ou eixo do levantamento e marcar explicitamente o ponto de decolagem.
* **Regras**:
  * Desenho manual no mapa: clique para adicionar vertices, arraste de vertices existentes para ajuste fino, inclusao de vertice intermediario e exclusao de vertice.
  * Importacao de arquivo local `.kml` ou `.geojson` (extraindo primeiro poligono para Grade Simples/Dupla ou primeira linha para Corredor Linear e ajustando o zoom para a geometria).
  * Ponto de decolagem (`takeoff_point`): marcador dedicado no mapa, editavel por clique ou arraste.
  * Caso o usuario nao posicione o ponto de decolagem manualmente, o app sugere automaticamente o vertice mais proximo do inicio da primeira linha e destaca um aviso recomendando confirmar o ponto real de decolagem antes de exportar com Terrain Follow.

### RF04: Modos de Missao no MVP
* **Descricao**: suportar tres padroes geometricos de mapeamento desde a primeira versao.
* **Regras**:
  * **Grade Simples (Poligono)**: linhas paralelas em vai-e-vem (boustrophedon) cobrindo o poligono desenhado ou importado.
  * **Grade Dupla (3D)**: duas grades ortogonais (angulo principal + angulo principal somado a 90 graus) sobre o mesmo poligono, ideal para reconstrucao 3D e fachadas/telhados complexos.
  * **Corredor Linear (Estradas e Linhas)**: usuario desenha ou importa uma polilinha e define a largura total da faixa (em metros); o app gera passadas paralelas ao eixo central cobrindo toda a largura configurada com a sobreposicao lateral informada.

### RF05: Motor Fotogrametrico e Calculo Bidirecional
* **Descricao**: calcular automaticamente espacamento entre linhas, distancia entre fotos, GSD, intervalo entre disparos e velocidade de voo.
* **Regras**:
  * Entradas principais: aeronave selecionada, altitude AGL (padrao 100 m; faixa 30 m a 120 m com alerta abaixo de 80 m e acima de 120 m), sobreposicao frontal (padrao 75%), sobreposicao lateral (padrao 65%), velocidade maxima desejada (padrao 9.0 m/s).
  * **Modo Automatico (padrao)**: o app calcula o passo longitudinal `d_photo`, testa os intervalos inteiros permitidos `{2, 3, 4, 5}` segundos e escolhe o menor intervalo `dt` cuja velocidade necessaria `v = d_photo / dt` seja menor ou igual a velocidade maxima configurada (preferindo manter a velocidade proxima do teto seguro para otimizar bateria).
  * Se mesmo com `dt = 5s` a velocidade exceder o limite configurado, o app trava na velocidade maxima e informa a sobreposicao frontal efetiva resultante (que sera maior que a alvo, sem perda de cobertura).
  * Se mesmo com `dt = 2s` a velocidade ficar abaixo de 1.0 m/s, o app avisa o usuario para revisar altitude ou sobreposicao.
  * **Modo Intervalo Travado (manual)**: o usuario pode fixar `2s`, `3s`, `4s` ou `5s` nos botoes segmentados e o app recalcula instantaneamente a velocidade exata necessaria (ou informa a sobreposicao efetiva se o usuario travar tambem a velocidade).
  * **Alerta de arrasto (rolling shutter)**: para aeronaves sem obturador mecanico, exibir aviso visual (`warning`) se a velocidade passar da velocidade segura do modelo (ex: > 10 m/s no Mini 4 Pro) ou se o deslocamento estimado por frame comprometer nitidez em baixa altitude.
  * Exibir em tempo real em fonte monoespacada: `GSD (cm/px)`, `Espacamento lateral (m)`, `Passo frontal (m)`, `Velocidade (m/s)` e `Intervalo (s)`.

### RF06: Geometria da Rota, Rotacao e Straighten Flight Path
* **Descricao**: otimizar orientacao das linhas e garantir trajetoria retilinea real no DJI Fly.
* **Regras**:
  * Slider e input numerico de rotacao de `0` a `359` graus.
  * Botao "Otimizar Angulo": alinha automaticamente as linhas ao lado mais longo do fecho convexo do poligono para reduzir o numero de curvas e economizar bateria.
  * Margem / Overshoot configuravel (padrao 15 m): estende levemente o inicio e fim de cada linha para fora do poligono garantindo cobertura completa das bordas e estabilizacao da aeronave antes das fotos.
  * **Straighten Flight Path (ativado por padrao)**: garante linhas de mapeamento estritamente retas no DJI Fly evitando curvas elipticas entre waypoints, combinando modo de curva de parada/descontinuidade e insercao de waypoints auxiliares de alinhamento nas cabeceiras quando o modo de curva suave estiver ativo.
  * Opcao de inverter sentido/ponto inicial da missao.

### RF07: Acompanhamento de Terreno (Terrain Follow) e Perfil Altimetrico
* **Descricao**: ajustar a altitude de cada waypoint conforme a variacao do relevo mantendo o GSD constante em relacao ao solo.
* **Regras**:
  * Modos selecionaveis: `Terrain Follow (AGL)` e `Altitude Fixa (relativa a decolagem)`.
  * No modo Terrain Follow, o app consulta a elevacao do ponto de decolagem (`E_takeoff`) e de cada waypoint (`E_wp`), alem de pontos intermediarios ao longo de linhas longas (amostragem maxima a cada 50 m em terreno inclinado), gravando no KMZ a altitude relativa `H_rel = Altitude_AGL + (E_wp - E_takeoff)`.
  * Fonte primaria de elevacao: AWS Elevation Tiles (Terrarium SRTM 30m) decodificados client-side em canvas com cache local de tiles; fallback automatico: Open-Meteo Elevation API.
  * Antes da exportacao (ou em painel expansivel), exibir um grafico de perfil altimetrico interativo mostrando elevacao do terreno, trajetoria do drone e altura AGL minima/maxima ao longo da distancia percorrida.
  * Exibir alerta critico (`danger`) se em modo Altitude Fixa a folga sobre o ponto mais alto do terreno ficar abaixo de 20 m ou negativa (risco de colisao).

### RF08: Parametros Operacionais e Disparo no KMZ
* **Descricao**: configurar comportamento de camera e seguranca da missao.
* **Regras**:
  * Angulo do gimbal: padrao `-90` graus (nadir), ajustavel entre `-90` e `-45` graus (util em Grade Dupla 3D).
  * Acao ao finalizar a missao: `Retornar para Casa (RTH)` (padrao), `Pairar (Hover)` ou `Pousar (Land)`.
  * Modo de disparo no KMZ:
    * `Automatico via WPML (Time Interval Shot)`: grava acao de inicio de disparo temporizado (`startTimeIntervalShot` com intervalo 2, 3, 4 ou 5s) no inicio das linhas e pausa nas transicoes/fim.
    * `Manual no DJI Fly`: nao grava acao de disparo no WPML e exibe destaque com o intervalo exato (2, 3, 4 ou 5s) que o piloto deve ativar no temporizador do DJI Fly antes de iniciar a rota.

### RF09: Telemetria Estimada e Divisao Automatica Multi-Bateria
* **Descricao**: estimar consumo operacional e fatiar automaticamente missoes extensas em partes voaveis por bateria.
* **Regras**:
  * Calcular e exibir: area total (ha e m2), distancia total de voo (m ou km), duracao estimada (min), total estimado de fotos, total de waypoints e numero de baterias necessarias.
  * O calculo de autonomia considera tempo de subida/transito do ponto de decolagem ate o inicio da parte, execucao da rota e retorno ao ponto de decolagem, descontando margem configuravel (padrao 20% de reserva).
  * **Divisao automatica**: quando a missao exceder a autonomia util de 1 bateria ou o limite seguro de waypoints por arquivo (padrao configuravel de 99 waypoints por parte para maxima compatibilidade com modelos DJI Fly), o app divide a rota automaticamente em `Parte 1`, `Parte 2`, ..., `Parte N`.
  * Cada parte e diferenciada visualmente por cor no mapa e exibe seu proprio resumo de tempo, distancia e waypoints.
  * O usuario pode exportar todas as partes em um unico `.zip` contendo arquivos `.kmz` numerados ou baixar partes individuais.

### RF10: Exportacao KMZ Compativel com DJI Fly
* **Descricao**: gerar arquivo `.kmz` valido segundo a especificacao WPML (DJI Waypoint Mission Language) pronto para substituicao no DJI Fly.
* **Regras**:
  * Cada `.kmz` e um arquivo ZIP contendo `wpmz/template.kml` e `wpmz/waylines.wpml` com coordenadas WGS84 (`lon,lat`), altitudes relativas ao ponto de decolagem (`relativeToStartPoint`), velocidade, orientacao de gimbal, acao final e waypoints retificados.
  * Nome padrao do arquivo: `<slug-da-missao>_parte1.kmz` (ou `<slug-da-missao>.kmz` quando bateria unica), editavel no dialogo de exportacao.
  * Validacao pre-exportacao bloqueia geracao se nao houver area desenhada, se houver menos de 2 waypoints ou se houver parametro numerico invalido.

### RF11: Guia Rapido de Substituicao no DJI Fly
* **Descricao**: disponibilizar um modal de ajuda rapida acessivel direto na barra superior de acoes ou na tela de exportacao.
* **Regras**:
  * Explicar passo a passo como criar uma missao placeholder no DJI Fly, localizar a pasta `waypoint` (no Android, DJI RC e DJI RC 2 via cabo USB/microSD) e substituir o arquivo `.kmz` mantendo o UUID original da pasta.

### RF12: Persistencia no Supabase (`ppr_missions` e `ppr_drone_profiles`)
* **Descricao**: permitir salvar planos de voo e perfis de drone customizados na conta do usuario sem tornar o salvamento obrigatorio para exportar.
* **Regras**:
  * Fluxo livre: o usuario pode desenhar, configurar e baixar o `.kmz` imediatamente sem salvar no banco.
  * Gaveta/modal "Minhas Missoes": listar planos salvos do usuario ordenados por `updated_at DESC`, com busca por nome e acoes de abrir, duplicar e excluir (com confirmacao).
  * Salvamento grava nome, tipo de missao, `drone_key`, geometria da area em GeoJSON, ponto de decolagem, todos os parametros de voo e resumo das metricas.
  * Perfis de drone customizados salvos em `ppr_drone_profiles` aparecem junto ao catalogo padrao no seletor de aeronave.

### RF13: Estados de Interface e Resiliencia
* **Descricao**: toda operacao assincrona (listagem de missoes, consulta de elevacao, salvamento) implementa os 4 estados obrigatorios: Loading, Empty, Error e Success.
* **Regras**:
  * Estado Empty ("Nenhuma missao salva ainda") nunca compartilha mensagem ou visual com estado Error ("Falha ao carregar missoes" + botao "Tentar novamente").
  * Se ambos os provedores de elevacao falharem, exibir alerta claro permitindo tentar novamente ou alternar para modo Altitude Fixa sem travar a aplicacao.

### RF14: Responsividade Desktop-First
* **Descricao**: otimizar planejamento detalhado no desktop e permitir consulta, ajuste de ponto de decolagem e exportacao em tablet/celular em campo.
* **Regras**:
  * Desktop (>= 1024px): mapa em tela cheia a esquerda/centro + painel lateral direito fixo e colapsavel (360px) + barra de telemetria compacta no topo/base.
  * Tablet e Mobile (< 1024px): mapa em tela cheia + controles de desenho compactos + painel de configuracao em bottom sheet recolhivel.
  * Alvos de toque de botoes principais com altura minima de 44px e `:focus-visible` com `--color-primary-soft`.

---

## 4. Requisitos de Banco de Dados (Supabase)

Os scripts SQL devem ser re-executaveis (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`) e nunca criar ou alterar policies em `applications`, `user_applications` ou `profiles`.

### Tabela `public.ppr_missions`
* `id` (`uuid`, PK, default `gen_random_uuid()`)
* `user_id` (`uuid`, NOT NULL, FK para `public.profiles(id)` ON DELETE CASCADE)
* `name` (`text`, NOT NULL)
* `mission_type` (`text`, NOT NULL, CHECK IN `('grid', 'double_grid', 'corridor')`)
* `drone_key` (`text`, NOT NULL)
* `area_geojson` (`jsonb`, NOT NULL)
* `takeoff_point` (`jsonb`, NULL)
* `flight_params` (`jsonb`, NOT NULL)
* `summary_metrics` (`jsonb`, NOT NULL)
* `created_at` (`timestamptz`, default `now()`)
* `updated_at` (`timestamptz`, default `now()`)

### Tabela `public.ppr_drone_profiles`
* `id` (`uuid`, PK, default `gen_random_uuid()`)
* `user_id` (`uuid`, NOT NULL, FK para `public.profiles(id)` ON DELETE CASCADE)
* `name` (`text`, NOT NULL)
* `sensor_width_mm` (`numeric(6,2)`, NOT NULL)
* `sensor_height_mm` (`numeric(6,2)`, NOT NULL)
* `focal_length_mm` (`numeric(6,2)`, NOT NULL)
* `image_width_px` (`integer`, NOT NULL)
* `image_height_px` (`integer`, NOT NULL)
* `max_flight_time_min` (`numeric(5,1)`, NOT NULL)
* `max_safe_speed_ms` (`numeric(4,1)`, NOT NULL)
* `has_mechanical_shutter` (`boolean`, NOT NULL, default `false`)
* `created_at` (`timestamptz`, default `now()`)
* `updated_at` (`timestamptz`, default `now()`)

### Politica RLS Padrao (aplicada a ambas as tabelas)
Usuario autenticado (`auth.uid() = user_id`) com registro ativo em `public.user_applications` ligado a `public.applications` onde `slug = 'pilot-pro'` e `is_active = true`.

---

## 5. Esbocos de Tela (Mockups Textuais)

### Layout Desktop (>= 1024px)

```text
+----------------------------------------------------------------------------------+
| [App Bridge Header: Allan Workbench | Seletor Ferramentas | Usuario | Sair]      |
+------------------------------------------------------+---------------------------+
| [Ferramentas Mapa: Poligono | Corredor | Decolagem   | PILOT PRO                 |
|  | Importar KML/GeoJSON | Camadas | Minhas Missoes]  | [Salvar] [Guia DJI Fly]   |
|                                                      |---------------------------|
|                                                      | AERONAVE                  |
|                                                      | [DJI Mini 4 Pro      v]   |
|                    MAPA SATELITE                     |                           |
|              (Leaflet + Esri Imagery)                | MISSAO                    |
|                                                      | [Grade] [Dupla] [Corredor]|
|        [Poligono + Linhas coloridas por bateria]     | Altitude:  [100 m  ----]  |
|        [Marcador de Decolagem (Home)]                | Sobr. Fr:  [75%    ----]  |
|                                                      | Sobr. Lat: [65%    ----]  |
|                                                      | Vel. Max:  [9.0m/s ----]  |
|                                                      | Intervalo: [Auto|2|3|4|5s]|
|                                                      | Rotacao:   [0 deg] [Auto] |
|                                                      | Overshoot: [15 m]         |
|                                                      | [x] Straighten Path       |
|                                                      | [x] Terrain Follow        |
|                                                      | Gimbal: -90 | Fim: RTH    |
|------------------------------------------------------| Disparo: [WPML | Manual]  |
| [Resumo Mono: 6.1 km | 13 min | 191 fotos | 1 bat    |---------------------------|
|  | GSD 2.68 cm/px | Espac. 50.0 m | 2s @ 8.9 m/s]    | [Alertas de Seguranca]    |
| [Botao: Ver Perfil Altimetrico]                      | [BOTAO VERDE: EXPORTAR]   |
+------------------------------------------------------+---------------------------+
```

### Layout Mobile / Tablet (< 1024px)

```text
+--------------------------------------+
| [App Bridge Header compacto]         |
+--------------------------------------+
| [Polig.] [Decol.] [Import] [Missoes] |
|                                      |
|            MAPA SATELITE             |
|            (Tela Cheia)              |
|                                      |
| [Chip: 13m | 191 ft | 1 bat | 50m]   |
+--------------------------------------+
| === Arrastar para expandir painel == |
| [Drone] [Parametros] [Exportar KMZ]  |
+--------------------------------------+
```

---

## 6. Lacunas Identificadas no `DESIGN.md`

O `DESIGN.md` global cobre muito bem canvas escuro (`#101010`), bordas hairline (`#3d3a39`), tipografia (`Inter` + `SF Mono`) e botoes principais (`#00d992`).
Para ferramentas geoespaciais como o Pilot Pro, foram mapeadas quatro lacunas que o Pilot Pro suprira em seu `styles.css` local e que podem ser incorporadas ao `DESIGN.md` global futuramente:

1. **Tokens semanticos de alerta operacional**: formalizar `--color-danger: #f87171` (ja citado no `AGENTS.md` global) e `--color-warning: #f59e0b` com fundos translúcidos (`rgba(248, 113, 113, 0.12)` e `rgba(245, 158, 11, 0.12)`) para alertas de rolling shutter, altitude e proximidade do solo.
2. **Superficies flutuantes e overlays cartograficos sobre satelite**: definir regra de contraste para toolbars flutuantes sobre imagens de satelite claras (ex: `background: rgba(16, 16, 16, 0.92)` com borda hairline) e paleta cartografica de alto contraste para poligono, rotas por bateria e ponto de decolagem.
3. **Controles de precisao numerica (sliders e seletores segmentados)**: o `DESIGN.md` atual documenta apenas `text-input` e botoes, sem especificacao visual para `input[type="range"]`, switches e grupos segmentados (`Auto | 2s | 3s | 4s | 5s`).
4. **Graficos tecnicos (Perfil Altimetrico)**: definir cores de serie de terreno, serie de altitude de voo, linha de limite minimo AGL e linhas de grade sutis sobre `#101010`.

---

## 7. Criterios de Aceitacao do MVP

1. Autenticacao via Portal funciona com `workbench-bridge.js` sem expor tokens na URL e redireciona ao Portal em caso de sessao ausente ou encerrada.
2. Usuario consegue criar missoes de Grade Simples, Grade Dupla e Corredor Linear tanto desenhando quanto importando KML/GeoJSON.
3. Calculo automatico de espacamento entre linhas, GSD, intervalo (2, 3, 4 ou 5s) e velocidade reproduz com precisao os valores fotogrametricos esperados (incluindo o caso de referencia Mini 4 Pro, 100 m, 65% lateral = 50.0 m).
4. Modo Terrain Follow ajusta altitudes relativas ao ponto de decolagem usando SRTM 30m (com fallback Open-Meteo) e renderiza o perfil altimetrico antes da exportacao.
5. Missoes longas sao divididas automaticamente em partes por bateria/waypoints e exportadas como `.kmz` unico ou `.zip` multi-parte com estrutura WPML valida (`wpmz/template.kml` e `wpmz/waylines.wpml`) e `Straighten Flight Path`.
6. Usuario consegue salvar, listar, reabrir, duplicar e excluir missoes e perfis customizados no Supabase com RLS ativa, alem de conseguir planejar e exportar sem salvar.
