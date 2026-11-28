// Plano do Extra 2027 para a escola de exemplo (nomes fictícios). Usado pelos testes e pelo servidor local (npm run local).
// O plano real (com os nomes da escola) não fica no repositório: vai na propriedade do script PLANO_EXTRA.
const EX1 = ['Extra 1A', 'Extra 2A', 'Extra 3A'], EX2 = ['Extra 4A', 'Extra 5A', 'Extra 5B'];
const EX6 = ['6A', '6B', '7A', '7B', '8A', '8B', '9A', '9B', '1 EM A', '1 EM B', '2 EM A', '2 EM B', '2 EM C', '3 EM A', '3 EM B'].map(t => 'Extra ' + t);
const PLANO = {
  grupos: { 'Extra 1º ao 5º': [EX1, EX2], 'Extra 6º ao EM': [EX6] },
  atribuicoes: [
    { tipo: 'Extra 1º ao 5º', grupos: [1], materia: 'Lição de Casa', professor: 'Jussara' }, { tipo: 'Extra 1º ao 5º', grupos: [1], materia: 'Recreação', professor: 'Natália' },
    { tipo: 'Extra 1º ao 5º', grupos: [2], materia: 'Lição de Casa', professor: 'Natália' }, { tipo: 'Extra 1º ao 5º', grupos: [2], materia: 'Recreação', professor: 'Adriana' },
    ...[['Reforço', 'Adriana'], ['Língua Inglesa', 'Giovana'], ['Língua Espanhola', 'Irene'], ['Teatro', 'Laura'], ['Defesa Pessoal', 'Mônica']].map(([materia, professor]) => ({ tipo: 'Extra 1º ao 5º', grupos: [1, 2], materia, professor })),
    ...['Vôlei', 'Futebol', 'Defesa Pessoal'].map(materia => ({ tipo: 'Extra 6º ao EM', grupos: [1], materia, professor: 'Nelson' })),
  ],
  cadastros: { Adriana: ['Reforço', 'Lição de Casa', 'Recreação'], Giovana: [], Irene: [], Nelson: ['Vôlei', 'Futebol', 'Defesa Pessoal'] },
  ajustes: [
    { materia: 'Biologia', turmas: ['1 EM A', '1 EM B'], de: 'Elias', para: 'Gilberto' },
    { materia: 'História das Religiões', turmas: ['9A', '9B'], de: 'Wagner', para: 'Vera' },
    { materia: 'Projeto de Vida', turmas: ['1 EM A'], de: 'Caio', para: 'Breno' },      // hoje é de Sílvia: não dá para fazer
    { materia: 'Matemática', turmas: ['1A'], de: 'Cecília', para: 'Bianca' },          // já é de Bianca
  ],
  limites: { geral: 42, soEM: 35 },   // no exemplo, os polivalentes do EFAI têm 42 aulas (na escola real: 40)
};
// Duas matérias fora da matriz nos Extras (para a limpeza aparecer) e o plano na propriedade do script
function prepararPlano(amb) {
  amb.ctx.gravar_('Carga', amb.ctx.valores_('Carga').concat([['Extra 1A', 'Atividades Lúdicas', 'Jussara', 2, 0, 1, '', ''], ['Extra 6A + Extra 6B', 'Arte e Natureza', 'Olga', 2, 0, 1, '', '']]));
  amb.props.PLANO_EXTRA = JSON.stringify(PLANO);
}
module.exports = { PLANO, EX1, EX2, EX6, prepararPlano };
