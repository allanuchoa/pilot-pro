# Diretrizes de Desenvolvimento e Agentes - Pilot Pro

Este documento define as regras tecnicas, contratos de integracao, formulas obrigatorias e padroes de qualidade para atuar no repositorio **Pilot Pro** (`pilot-pro`) do ecossistema **Allan Workbench**.

---

## 1. Isolamento de Contexto e Navegacao

* Atue exclusivamente dentro do diretorio desta ferramenta (`pilot-pro`).
* Nao leia, modifique ou dependa de arquivos de outras ferramentas do Allan Workbench.
* Consulte sempre os documentos locais do projeto: `./ARCHITECTURE.md`, `./PRODUCT_VISION.md`, `./PRD.md`, `./PRODUCT_ROADMAP.md`, `./TASKS.md` e `./AGENTS.md`.
* Use `./TASKS.md` como fila executavel de implementacao (ordem de fases, dependencias, paralelismo e criterios de conclusao).
* Use sempre caminhos relativos ao referenciar arquivos dentro de documentos ou codigo.

---

## 2. Restricoes Obrigatorias de Stack

* **HTML5 puro, CSS3 Vanilla e JavaScript ES6+ nativo**: e proibido introduzir React, Vue, Angular, Svelte, Next.js, TypeScript, Vite, Webpack, Rollup, Babel ou TailwindCSS.
* **Execucao direta sem build**: o aplicativo deve abrir e funcionar via servidor HTTP estatico simples (`python -m http.server 5500` ou `npx serve -l 5500`).
* **Bibliotecas externas permitidas (apenas via CDN com versao pinada)**:
  * `@supabase/supabase-js@2` (autenticacao e banco de dados).
  * `leaflet` (mapa interativo e camadas).
  * `@turf/turf` (calculos geoespaciais).
  * `jszip` (geracao de `.kmz` e `.zip` multi-bateria).
* Nenhuma biblioteca adicional deve ser introduzida sem justificativa explicita registrada no `./PRD.md`.

---

## 3. Contrato do Ecossistema (SSO, Bridge e Banco de Dados)

### Autenticacao e App Bridge
* Mantenha `<body style="display: none;">` no `index.html` e aguarde o evento `workbench-ready` disparado por `${CONFIG.PORTAL_URL}assets/js/workbench-bridge.js`.
* Nunca faca parsing de tokens de acesso na URL.
* Nunca exponha `service_role_key` no codigo cliente; utilize apenas `CONFIG.SUPABASE_ANON_KEY`.
* Registre `supabaseClient.auth.onAuthStateChange` reagindo a `SIGNED_OUT` com limpeza de estado e redirecionamento para `CONFIG.PORTAL_URL`.
* Valide toda URL de redirecionamento com `/^https?:\/\//`.
* Registre event listeners de elementos estaticos do DOM uma unica vez.

### Banco de Dados e Seguranca RLS
* Todas as tabelas proprias usam o prefixo `ppr_`: `public.ppr_missions` e `public.ppr_drone_profiles`.
* **Contrato do Registry (inatacavel)**: nunca execute `CREATE POLICY` ou `DROP POLICY` sobre `public.applications`, `public.user_applications` ou `public.profiles`.
  O script de onboarding apenas executa `INSERT ... ON CONFLICT` nessas tabelas.
* Todo script SQL versionado deve ser seguro para re-execucao:
  * `CREATE TABLE IF NOT EXISTS`
  * `CREATE OR REPLACE FUNCTION`
  * `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`
  * `DROP POLICY IF EXISTS` antes de `CREATE POLICY`
* Em toda query no front-end, aplique filtro explicito `.eq('user_id', session.user.id)` como defesa em profundidade em conjunto com a RLS.

---

## 4. Sistema Visual e Tokens Locais

Siga os tokens oficiais do `DESIGN.md` (tema Energy Dark: `--color-canvas: #101010`, `--color-canvas-soft: #1a1a1a`, `--color-hairline: #3d3a39`, `--color-primary: #00d992`, fontes `Inter` e `SF Mono`, bordas 1px sem sombras pesadas).
No `styles.css` local do Pilot Pro, estenda o `:root` apenas com os tokens operacionais necessarios para mapa e alertas:

```css
:root {
  --color-danger: #f87171;
  --color-danger-bg: rgba(248, 113, 113, 0.12);
  --color-warning: #f59e0b;
  --color-warning-bg: rgba(245, 158, 11, 0.12);
  --color-surface-overlay: rgba(16, 16, 16, 0.92);
  --color-route-bat-1: #00d992;
  --color-route-bat-2: #38bdf8;
  --color-route-bat-3: #f59e0b;
  --color-route-bat-4: #a78bfa;
  --color-polygon-stroke: #ffffff;
  --color-takeoff-marker: #00d992;
}
```

* Mantenha `:focus-visible { outline: 2px solid var(--color-primary-soft); outline-offset: 2px; }`.
* Implemente os 4 estados obrigatorios (Loading, Empty, Error e Success) em todas as operacoes assincronas (Supabase e elevacao), sem misturar mensagens de erro com estado vazio.

---

## 5. Formulas Matematicas Obrigatorias

Toda a logica matematica deve permanecer em funcoes puras dentro de `js/` sem acoplamento ao DOM.

### 5.1 Fotogrametria (`js/photogrammetry.js`)
Dados: altitude acima do solo `H` (m), largura do sensor `S_w` (mm), altura do sensor `S_h` (mm), distancia focal real `f` (mm), resolucao `I_w x I_h` (px), sobreposicao lateral `O_l` (0 a 0.95) e sobreposicao frontal `O_f` (0 a 0.95):

* **Cobertura no solo (footprint)**:
  * `W_g = H * (S_w / f)` (largura transversal a linha, em metros)
  * `H_g = H * (S_h / f)` (comprimento ao longo da linha, em metros)
* **GSD (Ground Sampling Distance em cm/px)**:
  * `GSD_cm = (W_g / I_w) * 100`
* **Espacamento entre linhas (cross-track)**:
  * `d_line = W_g * (1 - O_l)`
* **Distancia entre disparos consecutivos (along-track)**:
  * `d_photo = H_g * (1 - O_f)`
* **Acoplamento velocidade e intervalo (`dt` em `{2, 3, 4, 5}` segundos)**:
  * Para cada `dt` candidato, a velocidade exata para atingir `O_f` e `v(dt) = d_photo / dt`.
  * No modo automatico com limite `v_max` (padrao `9.0 m/s`), selecionar o menor `dt` em `{2, 3, 4, 5}` tal que `v(dt) <= v_max`.
  * Se nenhum `dt` satisfizer `v(dt) <= v_max`, selecionar `dt = 5`, travar `v = v_max` e calcular a sobreposicao frontal efetiva `O_f_eff = 1 - (v * dt) / H_g`.
  * Se o usuario travar `dt` manualmente, calcular `v = min(d_photo / dt, v_max_drone)` e exibir `O_f_eff` quando houver limitacao de velocidade.
* **Alerta de rolling shutter (arrasto)**:
  * Disparar alerta `warning` quando `!drone.has_mechanical_shutter` e (`v > drone.max_safe_speed_ms` ou `H < 80`).

### 5.2 Elevacao Terrarium (`js/elevation.js`)
Para tiles PNG do conjunto AWS Elevation Tiles (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom recomendado `z = 12` ou `13`):

* Decodificacao de altitude em metros a partir dos canais RGB do pixel:
  * `elevation_m = (R * 256 + G + B / 256) - 32768`
* Altitude relativa gravada no waypoint WPML (referenciada ao ponto de decolagem):
  * Modo Terrain Follow: `h_rel = H_agl + (E_wp - E_takeoff)`
  * Modo Altitude Fixa: `h_rel = H_agl`
* Folga real sobre o solo em cada ponto (para alertas de colisao):
  * `clearance_m = (E_takeoff + h_rel) - E_wp`
  * Disparar alerta `danger` se `clearance_m < 20`.

### 5.3 Straighten Flight Path e Multi-Bateria (`js/geometry.js`, `js/battery-splitter.js`)
* Para evitar trajetorias curvas elipticas no DJI Fly, cada linha de mapeamento deve usar transicao controlada (modo `toPointAndStopWithDiscontinuityCurvature` ou waypoints auxiliares de alinhamento posicionados a uma curta distancia das extremidades da linha).
* Tempo total estimado de cada parte de bateria considera: subida ate altitude inicial + deslocamento do ponto de decolagem ate o primeiro waypoint da parte + percurso de todos os segmentos da parte + tempo de parada/curva por vertice (~2.5s) + retorno do ultimo waypoint ao ponto de decolagem + descida.
* Fatiamento automatico respeita simultaneamente:
  * `tempo_parte <= drone.max_flight_time_min * (1 - reserve_ratio)` (reserva padrao de 20%).
  * `waypoints_parte <= max_waypoints_per_kmz` (padrao 99 waypoints por arquivo).

### 5.4 Estrutura Obrigatoria do Pacote `.kmz` (`js/wpml-exporter.js`)
Cada `.kmz` gerado deve ser um arquivo ZIP contendo exatamente:
* `wpmz/template.kml` (metadados da missao, `missionConfig` com `flyToWaylineMode`, `finishAction`, `takeOffSecurityHeight`, `globalTransitionalSpeed`, e `Folder` com configuracoes globais).
* `wpmz/waylines.wpml` (sequencia ordenada de `Placemark` com `<Point><coordinates>lon,lat</coordinates></Point>`, `<wpml:index>`, `<wpml:executeHeight>` relativa ao ponto de decolagem, `<wpml:waypointSpeed>`, `<wpml:waypointHeadingParam>`, `<wpml:waypointTurnParam>`, `<wpml:gimbalPitchAngle>` e, quando disparo automatico estiver ativo, bloco `<wpml:actionGroup>` com `startTimeIntervalShot` / `stopTimeIntervalShot`).

---

## 6. Verificacao e Testes Obrigatorios

Antes de concluir qualquer alteracao em logica de calculo, geometria, divisao de bateria ou serializacao XML:

1. Execute a suite de testes automatizados em Node.js (`node tests/run-tests.mjs`).
2. Mantenha testes cobrindo no minimo:
   * Caso de referencia fotogrametrica (`dji-mini-4-pro`, `H = 100 m`, `O_l = 0.65` => `d_line = 50.0 m`).
   * Selecao automatica e manual de intervalo `{2, 3, 4, 5}` s e alerta de rolling shutter.
   * Geracao de Grade Simples, Grade Dupla e Corredor Linear com `Straighten Flight Path`.
   * Decodificacao de pixel Terrarium e calculo de altitude relativa / alerta de colisao.
   * Fatiamento multi-bateria e limite de waypoints.
   * Validez estrutural do XML de `template.kml` e `waylines.wpml` dentro do ZIP `.kmz`.

---

## 7. Controle de Mudancas e Commits

* Atualize `docs/CHANGELOG.md` ao concluir qualquer alteracao relevante de codigo ou documentacao, seguindo formato `[Versao] - AAAA-MM-DD` com secoes `Adicionado`, `Modificado` e `Corrigido`.
* Escreva mensagens de commit objetivas e tecnicas, descrevendo a mudanca feita sem mencionar ferramentas ou nomes de agentes de IA.
