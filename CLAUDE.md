# Grade Horária · Objetivo CSA (ALBIX)

Sistema da coordenação do Objetivo CSA para montar a grade de aulas (professor × horário), estilo MatrUSP.
Google Sheets + Apps Script. O web app abre dentro de um iframe no GitHub Pages, para não aparecer o aviso do Google.
Primeiro cliente: Objetivo CSA (o mesmo do Giz Pay). Feito pela ALBIX.

## Estrutura
- `apps-script/` → código do Apps Script (sincronizado pelo clasp; `.clasp.json` na raiz aponta para cá)
  - `Codigo.js` → servidor: login/sessão, API única `api(token, acao, dados)` com permissões, leitura/escrita das abas, formulário, menu da planilha
  - `App.html` → o sistema (SPA): Início, Grade horária, Professores, Turmas e disciplinas, Aulas fixas, Horários, Usuários
  - `Formulario.html` → formulário único dos professores (`?form=1`, sem login): escolhe o nome (ou "sou novo") e marca os horários em que NÃO pode
  - `Gerador.html` → gerador da grade e reencaixe ("Trocar professor"); roda no navegador
  - `Estilo.html` (CSS e cores), `Comum.html` (funções comuns e a grade de disponibilidade)
  - `appsscript.json` → manifesto (web app: executa como quem implantou, acesso: qualquer pessoa)
- `docs/` → GitHub Pages: `index.html` (iframe para a URL /exec, repassa `?form=1`) + `logo.png`
- `tests/checar.js` → confere a sintaxe do JS das páginas simulando o Apps Script
- `.github/workflows/deploy.yml` → em PR: roda o teste; no merge na main: teste + `clasp push -f` + atualiza a implantação (a URL /exec não muda)

## Planilha (abas)
Config (turnos), Professores, Turmas, Carga (turma × disciplina × professor × aulas/semana × duplas × máx/dia), Fixas, Grade (oficial), Usuários (senhas visíveis — decisão do dono), Registro.
Disponibilidade é por aula, gravada como `Seg Manhã 1; Seg Manhã 2` (indisponível). Menu da planilha: ⚙️ Grade Horária → Preparar planilha / Criar dados de exemplo / Limpar dados.

## Regras importantes
- **NUNCA escrever `//` dentro de strings ou template literals nos `.html`**: o Apps Script corta do `//` até o fim da linha e a página fica em branco. Usar `'https:\/\/...'`. Rodar `node tests/checar.js` antes de abrir PR.
- O gerador roda no navegador (limite de 6 min do Apps Script). Usa arrays tipados e busca com reparo; não trocar por algo mais lento.
- "Trocar professor" (substituição no meio do semestre ou mudança de disponibilidade): **a grade dos outros professores não pode mudar**. Primeiro tenta sem mexer em ninguém; se for impossível, muda o mínimo e mostra a lista (De → Para) antes de aplicar.
- Toda ação da coordenação é feita por tela; ninguém deve precisar mexer na planilha.
- Telas enxutas, diretas, sem texto desnecessário. Público: coordenação escolar, pouco técnica.
- Identidade visual discreta: marinho `#041339`, azul `#1F4FA3`, amarelo `#F4C20D`, fundo `#F5F6FA`; Ubuntu nos títulos, Open Sans no texto. Não redesenhar o logo (marca da franquia Objetivo).
- Testes e exemplos só com nomes fictícios.
- Toda escrita no servidor passa por `LockService`; toda ação passa por `api()` com checagem de perfil (admin / coordenacao / consulta).

## Fluxo de trabalho
- Trabalhar sempre em branch e abrir PR. O merge na `main` publica sozinho.
- Nunca editar pelo editor online do Apps Script: o próximo `clasp push -f` sobrescreve (e apaga arquivos que só existam lá).
- Mudou as colunas de alguma aba? Avisar no PR: pode ser preciso rodar ⚙️ Grade Horária → Preparar planilha.
- Para testar localmente antes do merge: `npm run push` envia para o Apps Script (sem mudar a implantação) e dá para ver em Implantar → Testar implantações (URL /dev).
