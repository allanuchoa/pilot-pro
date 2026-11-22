# Backlog Executavel de Tasks - Pilot Pro

Este arquivo detalha todas as tarefas tecnicas do MVP do **Pilot Pro** em granularidade executavel para um agente orquestrador iniciando em contexto limpo.

---

## Como o Orquestrador Deve Usar Este Arquivo

1. Leia antes de iniciar: `./AGENTS.md`, `./ARCHITECTURE.md` e `./PRD.md`.
2. Execute as fases em ordem (`Fase 0` ate `Fase 4`).
3. Dentro de cada fase, tarefas marcadas como `Paralelo` podem ser delegadas simultaneamente respeitando o campo `Depende de`.
4. Ao concluir qualquer tarefa que crie ou altere arquivos em `js/`, execute `node tests/run-tests.mjs` e garanta 100% de aprovacao.
5. Marque `[x]` na tarefa concluida e registre marcos relevantes em `./docs/CHANGELOG.md`.
6. Nunca introduza frameworks, bundlers, TailwindCSS ou alteracoes nas policies RLS de `public.applications`, `public.user_applications` e `public.profiles`.

---

## Fase 0: Fundacao, Scaffold e Banco de Dados

### [x] T0.1 - Inicializar scaffold base e arquivos de configuracao
* **Depende de**: nenhuma.
* **Execucao**: Paralelo com `T0.2`.
* **Arquivos**: `config.js`, `supabase.js`, `.github/workflows/deploy.yml`, `README.md`, `docs/CHANGELOG.md`.
* **Escopo detalhado**:
  * Configurar `config.js` com `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_ID`, `PORTAL_URL` e chave opcional vazia `MAPTILER_KEY: ''`.
  * Configurar `supabase.js` com `getSupabaseClient()` usando `persistSession: true` e `storageKey: sb-${CONFIG.SUPABASE_PROJECT_ID}-auth-token`.
  * Configurar `.github/workflows/deploy.yml` para deploy estatico da branch `main` no GitHub Pages.
  * Criar `README.md` com instrucoes de execucao local (`python -m http.server 5500` ou `npx serve -l 5500`) e execucao de testes (`node tests/run-tests.mjs`).
  * Criar `docs/CHANGELOG.md` com versao `[0.1.0]` inicial.
* **Criterio de conclusao**: arquivos presentes na raiz e validados sem chaves privadas (`service_role_key`).

### [x] T0.2 - Criar scripts SQL do schema `ppr_*` e onboarding do Registry
* **Depende de**: nenhuma.
* **Execucao**: Paralelo com `T0.1`.
* **Arquivos**: `sql/001_schema_ppr.sql`, `sql/setup.sql`.
* **Escopo detalhado**:
  * Em `sql/001_schema_ppr.sql`, criar de forma re-executavel (`CREATE TABLE IF NOT EXISTS`) as tabelas `public.ppr_missions` e `public.ppr_drone_profiles` exatamente conforme o `./PRD.md`.
  * Criar funcao `public.ppr_set_updated_at()` (`CREATE OR REPLACE FUNCTION`) e triggers `BEFORE UPDATE` (`DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`) nas duas tabelas.
  * Ativar `ROW LEVEL SECURITY` nas duas tabelas e criar policies (`DROP POLICY IF EXISTS` antes de `CREATE POLICY`) exigindo `auth.uid() = user_id` e vinculo ativo em `public.user_applications` + `public.applications` (`slug = 'pilot-pro'`, `is_active = true`).
  * Em `sql/setup.sql`, registrar `pilot-pro` em `public.applications` (`ON CONFLICT (slug) DO UPDATE`) e vincular usuarios em `public.user_applications` (`ON CONFLICT DO NOTHING`), sem criar ou dropar policies nas tabelas do Registry.
* **Criterio de conclusao**: ambos os scripts sao seguros para re-execucao e nao contem `CREATE POLICY` ou `DROP POLICY` sobre `applications`, `user_applications` ou `profiles`.

### [x] T0.3 - Criar shell HTML e estilos base (`index.html` e `styles.css`)
* **Depende de**: `T0.1`.
* **Execucao**: Sequencial apos `T0.1`.
* **Arquivos**: `index.html`, `styles.css`.
* **Escopo detalhado**:
  * Em `index.html`, manter `<body style="display: none;">`, carregar fontes (`Inter` e monospace), carregar CDNs pinados (`@supabase/supabase-js@2`, `leaflet`, `@turf/turf`, `jszip`), injetar `${CONFIG.PORTAL_URL}assets/js/workbench-bridge.js` com `defer` e carregar `app.js` como `type="module"`.
  * Estruturar containers semanticos: toolbar flutuante do mapa, container `#map`, barra de telemetria em `SF Mono`, painel lateral colapsavel (desktop) / bottom sheet (mobile), painel expansivel do perfil altimetrico e modais (Exportar, Minhas Missoes, Perfil Customizado, Guia DJI Fly) mais container de fallback de erro.
  * Em `styles.css`, incluir todos os tokens de `DESIGN.md` mais os tokens locais definidos em `./AGENTS.md` (`--color-danger`, `--color-warning`, `--color-surface-overlay`, `--color-route-bat-1..4`), estilos de sliders, botoes segmentados, switches, estados Loading/Empty/Error, responsividade (`< 1024px`) e `:focus-visible`.
* **Criterio de conclusao**: pagina abre sem erros de sintaxe/CSS em servidor HTTP local e o layout ocupa `100dvh` descontando a altura do header do App Bridge.

---

## Fase 1: Mapa Base e Motor Fotogrametrico

### [x] T1.1 - Implementar catalogo de aeronaves (`js/drones.js`)
* **Depende de**: `T0.1`.
* **Execucao**: Paralelo com `T1.2` e `T1.3`.
* **Arquivos**: `js/drones.js`.
* **Escopo detalhado**:
  * Exportar `BUILTIN_DRONES` com os 5 modelos oficiais do `./PRD.md` (`dji-mini-4-pro`, `dji-mini-3-pro`, `dji-air-3`, `dji-air-3s`, `dji-mavic-3`).
  * Exportar `getDroneByKey(key, customProfiles)` e `validateCustomDrone(profile)` validando faixas fisicas validas (sensor > 0, focal > 0, resolucao inteira > 0, autonomia > 0, velocidade segura > 0).
* **Criterio de conclusao**: modulo ES puro sem dependencias de DOM, importavel tanto pelo navegador quanto por Node.js.

### [x] T1.2 - Implementar motor fotogrametrico (`js/photogrammetry.js`)
* **Depende de**: `T1.1`.
* **Execucao**: Paralelo com `T1.3`.
* **Arquivos**: `js/photogrammetry.js`.
* **Escopo detalhado**:
  * Exportar `calculatePhotogrammetry(drone, params)` recebendo `altitudeM`, `frontOverlapPct`, `sideOverlapPct`, `maxSpeedMs`, `intervalMode` (`'auto'` ou `2 | 3 | 4 | 5`).
  * Implementar exatamente as formulas da secao 5.1 de `./AGENTS.md`: `W_g`, `H_g`, `gsdCm`, `lineSpacingM`, `photoDistanceM`, escolha automatica ou travada de `intervalS` em `{2, 3, 4, 5}`, `flightSpeedMs`, `effectiveFrontOverlapPct`.
  * Retornar lista estruturada de alertas (`{ level: 'warning' | 'danger', code, message }`) cobrindo rolling shutter (`!drone.has_mechanical_shutter && (v > drone.max_safe_speed_ms || H < 80)`), altitude acima de 120 m, velocidade abaixo de 1.0 m/s e sobreposicao limitada por velocidade.
* **Criterio de conclusao**: caso `dji-mini-4-pro` com `H = 100 m` e `O_l = 65%` retorna `lineSpacingM === 50.0` (tolerancia `0.05 m`).

### [x] T1.3 - Implementar controlador de mapa (`js/map-controller.js`)
* **Depende de**: `T0.3`.
* **Execucao**: Paralelo com `T1.1` e `T1.2`.
* **Arquivos**: `js/map-controller.js`.
* **Escopo detalhado**:
  * Inicializar mapa Leaflet com camadas selecionaveis: Esri World Imagery (padrao), Carto Dark Matter, OpenStreetMap e camada opcional MapTiler se `CONFIG.MAPTILER_KEY` estiver preenchida.
  * Implementar ferramentas interativas de desenho e edicao de poligono e polilinha (clique para inserir vertice, arraste de marcador de vertice, clique direito ou botao para remover vertice, limpar desenho).
  * Implementar marcador dedicado de ponto de decolagem (clique no mapa em modo "Decolagem" ou arraste do pino) com callback de atualizacao.
  * Implementar metodos `renderMissionParts(parts)`, `fitToGeometry(geojson)`, `locateUser()` e `goToCoordinates(lat, lon)`.
* **Criterio de conclusao**: usuario consegue desenhar, editar vertices, mover o ponto de decolagem e alternar camadas sem erros no console.

### [x] T1.4 - Implementar motor geometrico base para Grade Simples (`js/geometry.js`)
* **Depende de**: `T1.1`, `T1.2`.
* **Execucao**: Sequencial apos `T1.2`.
* **Arquivos**: `js/geometry.js`.
* **Escopo detalhado**:
  * Receber instancia de `turf` por parametro ou `globalThis.turf` para manter compatibilidade com navegador e testes Node.js.
  * Exportar `computeOptimalAngle(polygonGeoJson)` calculando o azimute da maior aresta do fecho convexo do poligono.
  * Exportar `generateSimpleGrid(polygonGeoJson, options)` gerando linhas paralelas espacadas por `lineSpacingM`, rotacionadas em `angleDeg`, com `overshootM`, ordenacao em vai-e-vem (boustrophedon), suporte a `reverseDirection` e aplicacao de `straightenFlightPath` (marcando metadados de curva controlada e waypoints auxiliares nas extremidades das linhas).
  * Exportar `computeAreaSqm(polygonGeoJson)` e `suggestTakeoffPoint(waypoints)`.
* **Criterio de conclusao**: para qualquer poligono convexo ou concavo valido, gera sequencia ordenada de waypoints dentro da cobertura esperada com linhas estritamente paralelas.

### [x] T1.5 - Integrar Fase 1 no `app.js` e criar suite inicial de testes (`tests/run-tests.mjs`)
* **Depende de**: `T1.1`, `T1.2`, `T1.3`, `T1.4`.
* **Execucao**: Sequencial.
* **Arquivos**: `app.js`, `tests/run-tests.mjs`.
* **Escopo detalhado**:
  * Conectar evento `workbench-ready`, listener unico dos controles da interface, recalculo instantaneo da fotogrametria e da Grade Simples ao mover poligono ou ajustar sliders/inputs, atualizacao da barra de telemetria em `SF Mono` e exibicao de alertas.
  * Criar `tests/run-tests.mjs` usando `node:assert/strict` testando `drones.js`, `photogrammetry.js` e `geometry.js` (Grade Simples + angulo otimo + Straighten).
* **Criterio de conclusao**: `node tests/run-tests.mjs` passa 100% e a Grade Simples atualiza em tempo real no navegador.

---

## Fase 2: Modos de Missao Completos e Importacao

### [x] T2.1 - Implementar Grade Dupla (3D) em `js/geometry.js`
* **Depende de**: `T1.4`.
* **Execucao**: Paralelo com `T2.2` e `T2.3`.
* **Arquivos**: `js/geometry.js`.
* **Escopo detalhado**:
  * Exportar `generateDoubleGrid(polygonGeoJson, options)` executando duas passadas de grade simples (`angleDeg` e `(angleDeg + 90) % 360`) e escolhendo o ponto de entrada da segunda grade mais proximo do final da primeira para minimizar deslocamento ocioso.
  * Preservar marcacao de `isMappingSegment` e `straightenFlightPath` em ambas as malhas.
* **Criterio de conclusao**: numero total de linhas e waypoints corresponde a soma das duas malhas ortogonais conectadas sem salto desnecessario.

### [x] T2.2 - Implementar Corredor Linear em `js/geometry.js`
* **Depende de**: `T1.4`.
* **Execucao**: Paralelo com `T2.1` e `T2.3`.
* **Arquivos**: `js/geometry.js`.
* **Escopo detalhado**:
  * Exportar `generateCorridor(lineStringGeoJson, options)` recebendo `corridorWidthM`, `lineSpacingM`, `overshootM` e `straightenFlightPath`.
  * Calcular numero de passadas paralelas necessarias (`Math.max(1, Math.ceil(corridorWidthM / lineSpacingM))`), gerar offsets simetricos a esquerda/direita da polilinha central e encadear em vai-e-vem continuo.
* **Criterio de conclusao**: corredor com largura menor ou igual ao espacamento gera 1 passada central; larguras maiores geram passadas simetricas cobrindo toda a faixa.

### [x] T2.3 - Implementar parser de importacao `.kml` e `.geojson` em `js/geometry.js`
* **Depende de**: `T1.4`.
* **Execucao**: Paralelo com `T2.1` e `T2.2`.
* **Arquivos**: `js/geometry.js`.
* **Escopo detalhado**:
  * Exportar `parseAreaFile(filename, contentText)` suportando `.geojson` (`Feature`, `FeatureCollection`, `Polygon`, `MultiPolygon`, `LineString`) e `.kml` (`<Polygon>` e `<LineString>` via parsing leve de tags `<coordinates>` sem depender exclusivamente de `DOMParser` para funcionar tambem em Node.js).
  * Retornar `{ geometryType: 'polygon' | 'line', geojson, warnings }` ou lancar erro descritivo em arquivos corrompidos/vazios.
* **Criterio de conclusao**: parser extrai corretamente coordenadas `lon,lat` de arquivos KML e GeoJSON validos e rejeita entradas invalidas com mensagem clara.

### [x] T2.4 - Integrar modos de missao e importacao na UI + testes da Fase 2
* **Depende de**: `T2.1`, `T2.2`, `T2.3`, `T1.5`.
* **Execucao**: Sequencial.
* **Arquivos**: `app.js`, `js/map-controller.js`, `index.html`, `tests/run-tests.mjs`.
* **Escopo detalhado**:
  * Ligar seletor segmentado `Grade | Dupla | Corredor`, exibir controle `Largura do Corredor (m)` apenas no modo Corredor, alternar ferramenta de desenho entre poligono e polilinha, conectar input de upload `.kml`/`.geojson` ajustando automaticamente o tipo de missao e o zoom.
  * Adicionar testes unitarios de Grade Dupla, Corredor Linear e parser KML/GeoJSON em `tests/run-tests.mjs`.
* **Criterio de conclusao**: `node tests/run-tests.mjs` passa 100% e os 3 modos funcionam via desenho manual e via upload de arquivo.

---

## Fase 3: Terrain Follow, Perfil Altimetrico e Multi-Bateria

### [x] T3.1 - Implementar servico de elevacao (`js/elevation.js`)
* **Depende de**: `T1.4`.
* **Execucao**: Paralelo com `T3.2` e `T3.3`.
* **Arquivos**: `js/elevation.js`.
* **Escopo detalhado**:
  * Exportar funcoes puras `decodeTerrariumPixel(r, g, b)`, `latLonToTilePixel(lat, lon, zoom)`, `densifyWaypointsForTerrain(waypoints, maxSegmentM = 50)` e `computeRelativeAltitudes(waypoints, takeoffElevationM, altitudeAglM, mode)`.
  * Implementar busca de tiles PNG em `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (`z = 12`) com cache em `Map` por chave `z/x/y` e leitura RGB via `OffscreenCanvas` ou `<canvas>`.
  * Implementar fallback automatico em lote para `https://api.open-meteo.com/v1/elevation` (ate 100 pontos por requisicao) caso algum tile Terrarium falhe por rede ou CORS.
  * Calcular `clearanceM` em cada ponto e emitir alerta `danger` se `clearanceM < 20`.
* **Criterio de conclusao**: funcoes puras cobertas por testes Node e servico de rede retorna elevacoes com fallback resiliente.

### [x] T3.2 - Implementar grafico de perfil altimetrico (`js/profile-chart.js`)
* **Depende de**: `T0.3`.
* **Execucao**: Paralelo com `T3.1` e `T3.3`.
* **Arquivos**: `js/profile-chart.js`.
* **Escopo detalhado**:
  * Exportar `renderElevationProfile(containerEl, profilePoints, options)` renderizando SVG responsivo sobre `#101010` com area preenchida do terreno, linha da trajetoria do drone (`#00d992`), linha tracejada de alerta de folga minima (20 m) e eixos em `SF Mono`.
  * Suportar interacao por mouse/toque exibindo tooltip com distancia acumulada, elevacao do terreno (MSL), altitude relativa do waypoint e folga real AGL, disparando callback opcional `onHoverPoint(point)` para destacar a posicao no mapa.
* **Criterio de conclusao**: grafico renderiza corretamente tanto com 2 pontos quanto com 300+ pontos sem vazamento de listeners.

### [x] T3.3 - Implementar estimador de telemetria e divisor multi-bateria (`js/battery-splitter.js`)
* **Depende de**: `T1.4`.
* **Execucao**: Paralelo com `T3.1` e `T3.2`.
* **Arquivos**: `js/battery-splitter.js`.
* **Escopo detalhado**:
  * Exportar `splitMissionByBattery(waypoints, takeoffPoint, drone, options)` considerando `flightSpeedMs`, `transitionSpeedMs`, `intervalS`, `altitudeAglM`, `reserveRatio` (padrao `0.20`) e `maxWaypointsPerPart` (padrao `99`).
  * Calcular tempo realista por parte: subida + deslocamento do takeoff ao primeiro waypoint + percurso dos segmentos + tempo de parada/curva por vertice (`2.5 s`) + retorno ao takeoff + descida.
  * Quando o proximo waypoint exceder o tempo util da bateria ou `maxWaypointsPerPart`, encerrar a parte atual de forma limpa e iniciar nova parte a partir do ponto de retomada, numerando `partIndex` (`1..N`) e associando cor da paleta `--color-route-bat-1..4`.
  * Retornar `{ parts, totals: { distanceM, durationMin, estimatedPhotos, batteryCount, waypointCount } }`.
* **Criterio de conclusao**: nenhuma parte gerada excede o tempo util nem o limite de waypoints, mesmo em poligonos grandes.

### [x] T3.4 - Integrar Terrain Follow, perfil altimetrico e multi-bateria na UI + testes da Fase 3
* **Depende de**: `T3.1`, `T3.2`, `T3.3`, `T2.4`.
* **Execucao**: Sequencial.
* **Arquivos**: `app.js`, `js/map-controller.js`, `tests/run-tests.mjs`.
* **Escopo detalhado**:
  * Integrar toggle `Terrain Follow` / `Altitude Fixa`, carregamento assincrono de elevacao com estado `Loading` e `Error` (com botao "Tentar novamente" e opcao de alternar para Altitude Fixa).
  * Renderizar partes coloridas no mapa, cartoes de resumo por bateria e painel expansivel do grafico de perfil altimetrico sincronizado com marcador de hover no mapa.
  * Adicionar testes de decodificacao Terrarium, adensamento, calculo `h_rel` / alerta `clearance < 20m` e split multi-bateria/waypoints em `tests/run-tests.mjs`.
* **Criterio de conclusao**: `node tests/run-tests.mjs` passa 100% e missoes longas exibem partes coloridas e perfil altimetrico funcional.

---

## Fase 4: Exportador WPML/KMZ, Persistencia Supabase e Lancamento MVP

### [x] T4.1 - Implementar serializador WPML e gerador `.kmz` / `.zip` (`js/wpml-exporter.js`)
* **Depende de**: `T3.1`, `T3.3`.
* **Execucao**: Paralelo com `T4.2` e `T4.3`.
* **Arquivos**: `js/wpml-exporter.js`, `tests/run-tests.mjs`.
* **Escopo detalhado**:
  * Exportar `buildTemplateKml(part, config)` e `buildWaylinesWpml(part, config)` gerando XML valido com namespaces KML/WPML da DJI (`http://www.opengis.net/kml/2.2` e `http://www.dji.com/wpmz/1.0.2`), `flyToWaylineMode`, `finishAction` (`goHome` | `noAction` | `autoLand`), `takeOffSecurityHeight`, `executeHeightMode` (`relativeToStartPoint`), `waypointTurnParam` compativel com `Straighten Flight Path`, `gimbalPitchAngle` e bloco `<wpml:actionGroup>` com `startTimeIntervalShot` / `stopTimeIntervalShot` quando `triggerMode === 'wpml'`.
  * Exportar `exportMissionPackage(parts, config, JSZipImpl)` gerando um `.kmz` direto (`wpmz/template.kml` + `wpmz/waylines.wpml`) quando houver 1 parte, ou um `.zip` contendo `<slug>_parte1.kmz` ... `<slug>_parteN.kmz` (e permitindo download individual de cada parte).
  * Adicionar testes em `tests/run-tests.mjs` validando estrutura XML, tags obrigatorias, coordenadas `lon,lat`, altitudes relativas e disparo WPML vs manual.
* **Criterio de conclusao**: XMLs validados por testes automatizados e arquivos `.kmz` abrem como ZIP validos contendo exatamente `wpmz/template.kml` e `wpmz/waylines.wpml`.

### [x] T4.2 - Implementar repositorio Supabase (`js/storage.js`)
* **Depende de**: `T0.2`.
* **Execucao**: Paralelo com `T4.1` e `T4.3`.
* **Arquivos**: `js/storage.js`.
* **Escopo detalhado**:
  * Exportar operacoes CRUD para `ppr_missions` (`listMissions`, `saveMission`, `duplicateMission`, `deleteMission`) e `ppr_drone_profiles` (`listCustomDrones`, `saveCustomDrone`, `deleteCustomDrone`).
  * Aplicar `.eq('user_id', userId)` em todas as queries como defesa em profundidade.
  * Garantir retorno consistente diferenciando lista vazia (`[]`) de erro de rede/banco (`throw error`) para suportar os 4 estados obrigatorios na UI.
* **Criterio de conclusao**: operacoes funcionam contra o Supabase com RLS ativa sem impedir planejamento/exportacao sem salvamento previo.

### [x] T4.3 - Implementar modais operacionais (Minhas Missoes, Perfil Customizado, Guia DJI Fly)
* **Depende de**: `T0.3`.
* **Execucao**: Paralelo com `T4.1` e `T4.2`.
* **Arquivos**: `index.html`, `styles.css`, `app.js`.
* **Escopo detalhado**:
  * Modal/gaveta "Minhas Missoes": busca por nome, estados Loading, Empty, Error (com retry) e Success, botoes Abrir, Duplicar e Excluir (com confirmacao).
  * Modal "Perfil Customizado de Drone": formulario validado para criar/editar/excluir perfis em `ppr_drone_profiles`.
  * Modal "Guia Rapido DJI Fly": passo a passo conciso para Android, DJI RC e DJI RC 2 explicando a criacao da missao placeholder e a substituicao do arquivo `.kmz` mantendo o UUID original da pasta `waypoint`.
* **Criterio de conclusao**: todos os modais abrem/fecham por clique e tecla `Escape`, mantem foco visivel e respeitam os 4 estados de interface.

### [x] T4.4 - Integracao final, seguranca SSO, responsividade e fechamento do MVP
* **Depende de**: `T4.1`, `T4.2`, `T4.3`.
* **Execucao**: Sequencial (ultima tarefa do MVP).
* **Arquivos**: `app.js`, `styles.css`, `docs/CHANGELOG.md`, `README.md`.
* **Escopo detalhado**:
  * Conectar dialogo final de exportacao (nome do arquivo, resumo de partes, download individual ou `.zip` completo, destaque do intervalo em modo manual e link para o Guia DJI Fly).
  * Validar `supabaseClient.auth.onAuthStateChange` tratando `SIGNED_OUT` com limpeza de estado e redirecionamento validado por `/^https?:\/\//`.
  * Revisar responsividade em desktop (>= 1024px) e mobile/tablet (< 1024px com bottom sheet e botoes >= 44px), garantindo que nenhum listener de elemento estatico seja registrado mais de uma vez.
  * Executar suite completa `node tests/run-tests.mjs` e teste manual local em servidor HTTP estatico.
  * Atualizar `docs/CHANGELOG.md` com a versao `[1.0.0]` do MVP.
* **Criterio de conclusao**: todos os criterios de aceitacao da secao 7 do `./PRD.md` atendidos e suite `node tests/run-tests.mjs` 100% verde.
