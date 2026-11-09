# Grade Horária · Objetivo CSA (ALBIX)

Sistema da coordenação do Objetivo CSA para montar a grade de aulas (professor × horário), estilo MatrUSP.
Google Sheets + Apps Script. O web app abre dentro de um iframe no GitHub Pages, para não aparecer o aviso do Google.
Primeiro cliente: Objetivo CSA (o mesmo do Giz Pay). Feito pela ALBIX.

## Estrutura
- `apps-script/` → código do Apps Script (sincronizado pelo clasp; `.clasp.json` na raiz aponta para cá)
  - `Codigo.js` → servidor: login/sessão, API única `api(token, acao, dados)` com permissões, leitura/escrita das abas, migração do esquema, formulário, menu da planilha, estrutura padrão (grades, componentes, matriz 2025) e `dadosExemplo_()`
  - `App.html` → o sistema (SPA): Início, Grade horária, Professores, Turmas e disciplinas, Matriz curricular, Aulas fixas, Horários, Usuários
  - `Formulario.html` → formulário único dos professores (`?form=1`, sem login): escolhe o nome (ou "sou novo") e marca as faixas de 1h em que NÃO pode
  - `Gerador.html` → gerador da grade, validação e reencaixe ("Trocar professor"); roda no navegador
  - `Estilo.html` (CSS e cores), `Comum.html` (funções comuns, horários e o quadro de disponibilidade por faixas)
  - `appsscript.json` → manifesto (web app: executa como quem implantou, acesso: qualquer pessoa)
- `docs/` → GitHub Pages: `index.html` (iframe para a URL /exec, repassa `?form=1`), `logo.png` (azul: login e impressão), `logo-branco.png` (topo azul-marinho), `icone.png` (favicon). O servidor monta as URLs a partir de `CONFIG.ASSETS`.
- `tests/` → `checar.js` (regra do `//` e sintaxe), `gerador.js` (testes com a escola de exemplo), `ambiente.js` (Apps Script simulado com planilha em memória), `local.js` (servidor local para ver as telas)
- `.github/workflows/deploy.yml` → em PR: roda os testes; no merge na main: testes + `clasp push -f` + atualiza a implantação (a URL /exec não muda)
- `.github/prints/` → capturas de tela para PRs (só dados fictícios)
- `referencias/` → documentos internos da escola (nomes reais). Está no `.gitignore`: nunca commitar nem copiar nomes de lá.

## Planilha (abas)
- **Config** = grades de horário: uma linha por item (`Grade · Aula/Intervalo · Início · Fim`), em ordem. Padrão: EFAI Manhã, EFAI Tarde, EFAF Manhã, EFAF/EM Tarde, EM Manhã, Contraturno, Contraturno manhã (11:00–12:00).
- **Turmas**: turma · segmento (EFAI/EFAF/EM/Extra) · série · grade de horário. Grupos de contraturno são turmas do segmento Extra (EXTRA 1º ano A … , 6º/7º, 8º/9º, EM, EXTRA EFAI tarde, EXTRA EFAF tarde).
- **Carga**: turma(s) × disciplina × professor × aulas/semana × duplas × máx/dia. Turmas juntas na mesma linha: `5A + 5B` (mesma grade, mesmo professor, mesmo horário). Professor vazio = "a definir" (vira pendência).
- **Matriz** (série × componente × aulas) e **Componentes** (nome, sigla para impressão, apelidos do aSc separados por `;`). `acharComponente_()` reconhece nome, sigla ou apelido (sem acento/ponto/maiúscula) — base para importar o PDF do aSc.
- **Professores**: nome curto (chave, como no aSc) e nome completo. Disponibilidade por faixa de 1h, gravada como `Seg 7h; Seg 13h` (indisponível). Faixas: Manhã 7h–13h, Tarde 13h–19h.
- **Blocos**: professor · tipo (Complementação de Carga Horária / Plantão de Dúvidas) · disciplina (plantão) · dia · início · fim. Ocupam o professor; o gerador não mexe.
- **Fixas**, **Grade** (oficial; "Aula nº" = posição na grade de horário da turma), **Usuários** (senhas visíveis — decisão do dono), **Registro**.
- Colunas mudaram? Subir `ESQUEMA` em `Codigo.js` e tratar em `migrar_()` (roda sozinho na primeira chamada e em ⚙️ Grade Horária → Preparar planilha). Menu: Preparar planilha / Criar dados de exemplo / Limpar dados.

## Regras importantes
- **NUNCA escrever `//` dentro de strings ou template literals nos `.html`**: o Apps Script corta do `//` até o fim da linha e a página fica em branco. Usar `'https:\/\/...'`. Rodar `npm test` antes de abrir PR.
- O gerador roda no navegador (limite de 6 min do Apps Script). Usa arrays tipados e busca com reparo; não trocar por algo mais lento.
- **Tempo real**: o professor ocupa blocos de 10 min por dia; conflito = sobreposição de horário, mesmo entre grades diferentes (7:40–8:20 do EFAI × 8:00–8:50 do EFAF). A turma ocupa as aulas da própria grade. Aula dupla só em aulas contíguas (não atravessa intervalo). Janelas do professor em minutos (vãos acima de 30 min, manhã e tarde separadas). Todos os horários são múltiplos de 10.
- "Trocar professor" (substituição no meio do semestre ou mudança de disponibilidade): **a grade dos outros professores não pode mudar**. Primeiro tenta sem mexer em ninguém; se for impossível, muda o mínimo e mostra a lista (De → Para) antes de aplicar.
- Toda ação da coordenação é feita por tela; ninguém deve precisar mexer na planilha.
- Telas enxutas, diretas, sem texto desnecessário. Público: coordenação escolar, pouco técnica.
- Identidade visual discreta: marinho `#041339`, azul `#1F4FA3`, amarelo `#F4C20D`, fundo `#F5F6FA`; Ubuntu nos títulos, Open Sans no texto. Não redesenhar o logo (marca da franquia Objetivo); usar os PNGs de `docs/` sem cortar; manter o texto "Objetivo CSA" como reserva.
- Testes, exemplos, prints e commits só com nomes fictícios.
- Toda escrita no servidor passa por `LockService`; toda ação passa por `api()` com checagem de perfil (admin / coordenacao / consulta).

## Fluxo de trabalho
- Trabalhar sempre em branch e abrir PR. O merge na `main` publica sozinho.
- Nunca editar pelo editor online do Apps Script: o próximo `clasp push -f` sobrescreve (e apaga arquivos que só existam lá).
- `npm test` = checagem do `//` + testes do gerador. `npm run local` = sistema em http://localhost:8787 com a escola de exemplo (admin / teste); `?auto=1&tela=grade` abre direto numa tela (útil para prints com o Edge/Chrome headless).
- Mudou as colunas de alguma aba? Avisar no PR: pode ser preciso rodar ⚙️ Grade Horária → Preparar planilha.
- Para testar no Apps Script antes do merge: `npm run push` envia (sem mudar a implantação) e dá para ver em Implantar → Testar implantações (URL /dev).
