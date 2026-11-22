# Roadmap de Produto - Pilot Pro

Este documento organiza o sequenciamento de entregas da ferramenta **Pilot Pro** no ecossistema **Allan Workbench**, separando o escopo completo do MVP (Fases 0 a 4) das evolucoes futuras (Fase 5+).

---

## Fase 0: Fundacao, Arquitetura e Onboarding (Atual)

**Objetivo**: fechar todas as decisoes de produto, arquitetura, matematica e contrato de integracao antes de escrever codigo de producao.

* Consolidacao dos documentos `ARCHITECTURE.md`, `PRODUCT_VISION.md`, `PRD.md`, `PRODUCT_ROADMAP.md` e `AGENTS.md`.
* Revisao de lacunas do `DESIGN.md` para aplicacoes cartograficas.
* Copia do scaffold base do Allan Workbench (`index.html`, `styles.css`, `config.js`, `supabase.js`, `app.js`, `.github/workflows/deploy.yml`).
* Criacao dos scripts SQL re-executaveis `sql/001_schema_ppr.sql` (tabelas `ppr_missions` e `ppr_drone_profiles` + RLS) e `sql/setup.sql` (registro em `applications` e `user_applications`).
* Criacao de `README.md` e `docs/CHANGELOG.md`.

**Criterio de saida**: estrutura estatica inicial carregando com `workbench-bridge.js` e ferramenta registrada no Registry do Supabase.

---

## Fase 1: Mapa Base e Motor Fotogrametrico

**Objetivo**: entregar o nucleo matematico testado e o mapa interativo capaz de gerar a primeira grade de voo com linhas retas.

* Integracao do Leaflet via CDN com camadas Esri World Imagery, Carto Dark e OpenStreetMap.
* Implementacao de `js/drones.js` com o catalogo DJI Fly (Mini 4 Pro, Mini 3 / 3 Pro, Air 3, Air 3S, Mavic 3 / Classic / Pro) e suporte a perfil customizado.
* Implementacao de `js/photogrammetry.js` com calculo bidirecional (altitude, sobreposicao frontal/lateral, velocidade maxima, selecao automatica de intervalo 2/3/4/5s, trava manual, GSD e alerta de rolling shutter).
* Desenho e edicao interativa de poligono e marcador de ponto de decolagem no mapa.
* Implementacao inicial de `js/geometry.js` para Grade Simples, rotacao manual/automatica, overshoot e `Straighten Flight Path`.
* Suite de testes automatizados em `tests/run-tests.mjs` cobrindo toda a matematica fotogrametrica e geometria base.

**Criterio de saida**: usuario desenha um poligono no mapa, ajusta altitude/sobreposicao e visualiza as linhas retificadas e todas as metricas em tempo real.

---

## Fase 2: Modos de Missao Completos e Importacao

**Objetivo**: completar todas as geometrias previstas no MVP.

* Implementacao de Grade Dupla (3D) com segunda malha ortogonal (+90 graus) e controle de gimbal inclinado.
* Implementacao de Corredor Linear (estradas e faixas) a partir de polilinha com largura configuravel e multiplas passadas paralelas.
* Importacao client-side de arquivos `.kml` e `.geojson` (poligonos e linhas) com validacao de formato e centralizacao automatica do mapa.
* Acoes rapidas de inversao de rota e centralizacao por geolocalizacao ou coordenadas manuais.

**Criterio de saida**: todos os tres modos de missao funcionam com desenho manual e importacao de arquivos, cobertos por testes em `tests/run-tests.mjs`.

---

## Fase 3: Terrain Follow, Perfil Altimetrico e Multi-Bateria

**Objetivo**: adicionar consciencia de terreno e divisao operacional para grandes areas.

* Implementacao de `js/elevation.js` consumindo AWS Elevation Tiles (Terrarium SRTM 30m) com cache em memoria e fallback automatico para Open-Meteo Elevation API.
* Adensamento de waypoints em trechos longos com variacao de relevo e calculo de altitude relativa ao ponto de decolagem (`E_wp - E_takeoff + AGL`).
* Implementacao de `js/profile-chart.js` exibindo perfil do terreno, linha de voo, AGL minima/maxima e alertas de seguranca/colisao.
* Implementacao de `js/battery-splitter.js` calculando distancia, duracao, fotos e fatiando automaticamente missoes que ultrapassem autonomia util ou limite de waypoints, com cores distintas por parte no mapa.

**Criterio de saida**: usuario visualiza o perfil altimetrico completo e ve a missao longa dividida em partes por bateria com metricas individuais.

---

## Fase 4: Exportador WPML/KMZ, Persistencia Supabase e Lancamento do MVP

**Objetivo**: concluir a exportacao validada para o DJI Fly, a persistencia em nuvem e a experiencia responsiva final.

* Implementacao de `js/wpml-exporter.js` gerando `wpmz/template.kml` e `wpmz/waylines.wpml` empacotados via JSZip (`.kmz` unico ou `.zip` multi-bateria), com suporte a disparo automatico WPML ou modo manual.
* Validacao estrutural dos XMLs gerados via testes automatizados e validacao pratica importando no aplicativo DJI Fly.
* Implementacao de `js/storage.js` conectando `ppr_missions` e `ppr_drone_profiles` no Supabase com os 4 estados obrigatorios de interface (Loading, Empty, Error, Success).
* Modal com guia passo a passo de substituicao do `.kmz` no DJI Fly (Android, DJI RC e DJI RC 2).
* Polimento responsivo (painel colapsavel desktop + bottom sheet mobile/tablet), acessibilidade de teclado (`:focus-visible`) e deploy continuo via GitHub Actions no GitHub Pages.

**Criterio de saida**: MVP completo em producao no Allan Workbench, validado de ponta a ponta em voo real ou simulado no DJI Fly.

---

## Fase 5: Evolucoes Pos-MVP (v2+)

Itens deliberadamente adiados para manter o MVP enxuto, rapido de entregar e facil de validar:

* **Upload de MDT/DEM local (GeoTIFF)**: permitir usar modelos digitais de terreno de alta resolucao (ex: gerados por levantamentos previos ou LiDAR) em vez de SRTM 30m.
* **Zonas de exclusao e obstaculos**: marcar poligonos de obstaculos ou altura minima local para desvio ou elevacao segura.
* **Compensacao de vento na autonomia**: estimativa de impacto de velocidade/direcao do vento no tempo de bateria e escolha de direcao ideal das linhas.
* **Relatorio tecnico de missao (PDF/Impressao)**: ficha de campo com mapa, coordenadas de decolagem, parametros, GSD, numero de baterias e checklist pre-voo.
* **Modo offline em campo (PWA / Cache local)**: consultar e reexportar missoes salvas em areas rurais sem sinal de celular.
* **Visualizacao 3D da trajetoria**: inspecao tridimensional do relevo e das linhas de voo sobre o terreno (opcionalmente com MapLibre GL).
* **Exportacao adicional**: suporte futuro a formato Litchi CSV ou KML de visualizacao para Google Earth.
