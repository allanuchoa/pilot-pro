# Visao de Produto - Pilot Pro

O **Pilot Pro** e uma ferramenta web de planejamento de voos fotogrametricos integrada ao ecossistema **Allan Workbench**.
Seu proposito e permitir que pilotos e engenheiros desenhem ou importem uma area de interesse no mapa, ajustem parametros essenciais de mapeamento e exportem arquivos `.kmz` prontos para substituicao direta no aplicativo oficial **DJI Fly**.

---

## 1. O Problema

A linha consumer recente da DJI (Mini 3 Pro, Mini 4 Pro, Air 3, Air 3S e serie Mavic 3) oferece excelente qualidade optica e custo acessivel para mapeamento aereo em engenharia e projetos de energia.
Entretanto, a maior parte dessas aeronaves nao possui SDK mobile liberado para aplicativos terceiros controlarem o voo diretamente.

A alternativa segura adotada pelo mercado e gerar planos de waypoints em formato `.kmz` (WPML) e substitui-los na pasta de missoes do proprio **DJI Fly**, mantendo a seguranca do aplicativo oficial da fabricante.
As solucoes existentes hoje apresentam friccoes importantes para o fluxo tecnico:

1. **Dependencia de planilhas manuais**: ferramentas web gratuitas como o Waypoint Pro exigem que o usuario calcule externamente em planilha o espacamento entre linhas para atingir a sobreposicao desejada.
2. **Recursos essenciais trancados em assinaturas pagas**: funcoes criticas para mapeamento real, como alinhamento reto das linhas de voo (`Straighten Flight Path`) e acompanhamento de terreno (`Terrain Follow`), exigem planos pagos em apps de terceiros.
3. **Fluxo fragmentado entre escritorio e campo**: aplicativos exclusivamente mobile dificultam importar poligonos KML/GeoJSON de engenharia e planejar grandes areas multi-bateria no computador antes da ida a campo.
4. **Falta de integracao com o ecossistema de trabalho**: planos criados em ferramentas externas ficam dispersos, sem historico centralizado na conta do usuario no Allan Workbench.

---

## 2. A Solucao (Proposta de Valor)

O **Pilot Pro** reune em uma interface web escura, limpa e focada em engenharia o melhor das referencias de mercado, eliminando calculos manuais e custos recorrentes de assinatura:

* **Calculo fotogrametrico automatico**: a partir do modelo do drone, altitude e sobreposicoes frontal e lateral desejadas, o app calcula automaticamente a distancia entre linhas, o GSD (cm/px), a temporizacao ideal entre disparos (2, 3, 4 ou 5s) e a velocidade exata de voo respeitando limites contra arrasto (rolling shutter).
* **Geometria completa de mapeamento**: suporte nativo no MVP a Grade Simples (poligono), Grade Dupla (3D) e Corredor Linear (estradas e linhas de transmissao), alem de importacao de arquivos KML/GeoJSON.
* **Precisao de trajetoria e terreno**: linhas retas reais (`Straighten Flight Path`), ponto de decolagem configuravel, acompanhamento de terreno (`Terrain Follow`) com visualizacao de perfil altimetrico antes da exportacao e divisao automatica em multiplos arquivos `.kmz` para missoes com mais de uma bateria.
* **Pronto para o Allan Workbench**: login unico transparente (SSO), identidade visual unificada (`DESIGN.md`), persistencia em nuvem no Supabase e abertura instantanea no navegador sem instalacao.

---

## 3. Personas Principais

### Engenheiro de Projetos e Levantamento em Campo
Planeja levantamentos de terrenos, telhados industriais, usinas solares, acessos rodoviarios e faixas de servidao.
Precisa importar limites em KML/GeoJSON do projeto, validar quantas baterias serao necessarias antes de sair do escritorio e garantir sobreposicao consistente para gerar ortomosaicos e modelos digitais confiaveis.

### Piloto de Drone Operando DJI Fly
Executa a missao em campo usando controle DJI RC, RC 2 ou celular Android com DJI Fly.
Precisa ajustar rapidamente o ponto exato de decolagem em campo (inclusive via tablet ou celular), conferir o perfil de terreno para evitar colisoes e baixar o `.kmz` dividido por bateria com instrucoes rapidas de substituicao.

### Agente de IA Mantenedor do Repositorio
Evolui e testa o codigo da ferramenta de forma isolada dentro do Allan Workbench.
Precisa de arquitetura enxuta sem bundler, formulas matematicas explicitamente documentadas e testes automatizados rapidos para evitar regressoes nos calculos de voo e no XML WPML.

---

## 4. Pilares Estrategicos do Produto

1. **Matematica transparente e confiavel**: nenhum numero magico escondido.
   O usuario visualiza em tempo real GSD, distancia entre linhas, passo entre fotos, velocidade calculada, intervalo de disparo e avisos de arrasto ou seguranca.
2. **Seguranca operacional primeiro**: o app alerta sobre altitudes inadequadas, risco de aproximacao do solo no perfil altimetrico, excesso de velocidade em obturador eletronico e necessidade de troca de bateria.
3. **Zero friccao para planejar e exportar**: o usuario pode desenhar e exportar um `.kmz` em menos de dois minutos sem ser obrigado a preencher cadastros burocraticos, salvando o plano no Supabase apenas quando desejar.
4. **Independencia total no ecossistema**: 100% client-side, gratuito em infraestrutura (GitHub Pages + fontes abertas de mapa e elevacao) e aderente ao contrato do Allan Workbench.

---

## 5. Fronteiras do Produto (O que o Pilot Pro NAO e)

* **Nao e um aplicativo de pilotagem em tempo real**: o Pilot Pro nao conecta via cabo ou radio ao drone e nao substitui o DJI Fly durante o voo.
* **Nao e um software de processamento fotogrametrico**: o app gera o plano de voo para captura das imagens, mas o processamento de ortomosaicos e nuvens de pontos ocorre em ferramentas externas (como WebODM, Agisoft Metashape ou Pix4D).
* **Nao substitui analise de espaco aereo e obstaculos**: o piloto continua responsavel por autorizacoes DECEA/SARPAS, checagem visual de obstaculos verticais (postes, cabos, arvores) e condicoes climaticas.

---

## 6. Metricas de Sucesso

* **Tempo ate o primeiro KMZ valido**: menos de 2 minutos entre abrir a ferramenta, definir area/decolagem e baixar o arquivo pronto.
* **Taxa de importacao bem-sucedida no DJI Fly**: 100% dos arquivos `.kmz` gerados abrindo corretamente no DJI Fly com trajetoria reta, altitude coerente e acao final configurada.
* **Zero uso de planilhas externas**: eliminacao completa da consulta manual de espacamento entre linhas e temporizacao de disparos.
* **Reaproveitamento em campo**: reducao do retrabalho atraves do historico de missoes salvas e duplicaveis no Supabase.
