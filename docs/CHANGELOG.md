# Changelog - Pilot Pro

Todas as mudancas relevantes do projeto Pilot Pro sao registradas neste arquivo.

## [1.0.1] - 2026-11-22

### Adicionado
* Camada satelite hibrida Esri composta por `World_Imagery`, `World_Boundaries_and_Places` e `World_Transportation`, com controle independente para exibir ou ocultar rotulos no menu de camadas.
* Parser de coordenadas (`parseCoordinatePair` e `parseSingleCoordinate`) com suporte a colagem direta de pares decimais e GMS/DMS no popover de navegacao, coberto por teste automatizado em `tests/run-tests.mjs`.
* Aviso operacional no topo do modal Guia Rapido DJI Fly reforçando o uso do modo foto 12 MP em proporcao 4:3 antes de iniciar a missao.
* Indicador visual de status de salvamento na base da barra lateral e opcao marcada por padrao para salvar ou atualizar a missao automaticamente ao exportar o pacote `.kmz`/`.zip`.

### Modificado
* Centro inicial padrao do mapa e placeholders de coordenadas ajustados para a regiao de Aquiraz-CE (`-3.964863, -38.377869`, zoom 12).
* Camada escura migrada do Carto Dark Matter para Esri Dark Gray Canvas (`World_Dark_Gray_Base` e `World_Dark_Gray_Reference`) sem necessidade de chave de API.
* Alternancia entre poligono e corredor ou clique em limpar area agora solicita confirmacao quando ha geometria desenhada, enquanto o modo de marcacao de decolagem preserva integralmente a geometria e a rota atuais.

### Corrigido
* Corrigido overflow horizontal no popover de coordenadas em `styles.css` e garantia de rastreamento de alteracoes pendentes (`markMissionDirty`) em todos os controles de parametrizacao em `app.js`.

## [1.0.0] - 2026-11-22

### Adicionado
* Catalogo oficial de aeronaves DJI Fly e validacao de perfis customizados em `js/drones.js`.
* Motor fotogrametrico puro em `js/photogrammetry.js` com calculo de footprint, GSD, espacamento lateral, passo frontal, acoplamento automatico/manual de intervalo `{2, 3, 4, 5}` s e alerta de rolling shutter.
* Motor geometrico em `js/geometry.js` com suporte a Grade Simples, Grade Dupla (3D), Corredor Linear, otimizacao de angulo pela maior aresta, overshoot configuravel, Straighten Flight Path e importacao de arquivos `.kml` e `.geojson`.
* Servico de elevacao em `js/elevation.js` com decodificacao de tiles AWS Terrarium (SRTM 30m), adensamento de waypoints, fallback automatico para Open-Meteo Elevation API e alerta critico de folga abaixo de 20 m.
* Grafico SVG interativo de perfil altimetrico em `js/profile-chart.js` sincronizado com o mapa.
* Estimador de telemetria e divisor multi-bateria em `js/battery-splitter.js` respeitando reserva de 20% e limite de 99 waypoints por arquivo `.kmz`.
* Serializador WPML/KMZ em `js/wpml-exporter.js` gerando `wpmz/template.kml` e `wpmz/waylines.wpml` compativeis com DJI Fly, com empacotamento individual `.kmz` ou multi-parte `.zip`.
* Controlador interativo de mapa Leaflet em `js/map-controller.js` com camadas Esri World Imagery, Carto Dark Matter e OpenStreetMap, edicao de vertices, marcador de decolagem e rotas coloridas por bateria.
* Interface Energy Dark responsiva (`index.html`, `styles.css` e `app.js`) integrada ao SSO e App Bridge (`workbench-bridge.js`), com modais de Minhas Missoes, Perfil Customizado de Drone, Guia Rapido DJI Fly e Exportacao.
* Suite automatizada de testes em `tests/run-tests.mjs` cobrindo toda a logica pura do MVP.

## [0.1.0] - 2026-11-22

### Adicionado
* Configuracao base do ecossistema em `config.js` e cliente singleton autenticado em `supabase.js`.
* Workflow de deploy estatico para GitHub Pages em `.github/workflows/deploy.yml`.
* Schema SQL re-executavel das tabelas `public.ppr_missions` e `public.ppr_drone_profiles` com triggers e politicas RLS em `sql/001_schema_ppr.sql`.
* Script de onboarding do aplicativo `pilot-pro` no Registry global em `sql/setup.sql`.
* Repositorio client-side de persistencia no Supabase em `js/storage.js` com filtro explicito por `user_id`.
* Documentacao operacional inicial em `README.md` e historico em `docs/CHANGELOG.md`.
