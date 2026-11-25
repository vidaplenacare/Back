import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function lerMinutos(variavel: string, padrao: number): number {
  const valor = Number(process.env[variavel]);
  return Number.isFinite(valor) ? valor : padrao;
}

const AVISO_MINUTOS_ANTES = lerMinutos('AVISO_MINUTOS_ANTES', 30);

// Mesmos 4 registros (mesmos ids) de vida-plena-app/src/data/profissionais.ts — mantidos
// sincronizados manualmente enquanto essa tela ainda tem uma fonte de dados estática no app.
const profissionais = [
  {
    id: 'prof-1',
    nome: 'Ana Paula Santos',
    especialidade: 'Enfermagem Geriátrica',
    categoria: 'enfermeiro' as const,
    experiencia: '8 anos',
    avaliacao: 4.9,
    totalAvaliacoes: 127,
    foto: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&h=400&fit=crop',
    nivelOcupacao: 'livre' as const,
    bio: 'Enfermeira especializada em cuidados geriátricos, com foco em curativos, administração de medicamentos e acompanhamento de doenças crônicas.',
    formacao: 'CRT Enfermagem · Especialização em Geriatria',
    areasAtuacao: ['Curativos', 'Administração de medicamentos', 'Acompanhamento de crônicos'],
    disponibilidade: 'Segunda a sábado, 8h às 18h',
    diasDisponiveis: [1, 2, 3, 4, 5, 6],
    horarioInicio: '08:00',
    horarioFim: '18:00',
    valorVisita: 180,
    telefone: '11987654321',
  },
  {
    id: 'prof-2',
    nome: 'Carlos Eduardo Silva',
    especialidade: 'Cuidador de Idosos',
    categoria: 'cuidador' as const,
    experiencia: '5 anos',
    avaliacao: 4.8,
    totalAvaliacoes: 89,
    foto: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&h=400&fit=crop',
    nivelOcupacao: 'parcial' as const,
    bio: 'Cuidador com experiência em higiene pessoal, mobilidade e apoio em atividades diárias para idosos com Alzheimer e mobilidade reduzida.',
    formacao: 'Curso Técnico em Cuidados com Idosos · Alzheimer',
    areasAtuacao: ['Higiene pessoal', 'Mobilidade', 'Alzheimer'],
    disponibilidade: 'Todos os dias, período integral',
    diasDisponiveis: [0, 1, 2, 3, 4, 5, 6],
    horarioInicio: '07:00',
    horarioFim: '21:00',
    valorVisita: 120,
    telefone: '11976543210',
  },
  {
    id: 'prof-3',
    nome: 'Mariana Costa',
    especialidade: 'Fisioterapia Motora',
    categoria: 'fisioterapeuta' as const,
    experiencia: '10 anos',
    avaliacao: 5.0,
    totalAvaliacoes: 156,
    foto: 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=400&h=400&fit=crop',
    nivelOcupacao: 'lotado' as const,
    bio: 'Fisioterapeuta especializada em reabilitação motora e prevenção de quedas, com atendimento domiciliar personalizado.',
    formacao: 'CRT Fisioterapia · Reabilitação Motora',
    areasAtuacao: ['Reabilitação motora', 'Prevenção de quedas', 'Fortalecimento muscular'],
    disponibilidade: 'Terça a sexta, 9h às 17h',
    diasDisponiveis: [2, 3, 4, 5],
    horarioInicio: '09:00',
    horarioFim: '17:00',
    valorVisita: 150,
    telefone: '11965432109',
  },
  {
    id: 'prof-4',
    nome: 'Roberto Almeida',
    especialidade: 'Acompanhante Noturno',
    categoria: 'acompanhante' as const,
    experiencia: '6 anos',
    avaliacao: 4.7,
    totalAvaliacoes: 73,
    foto: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&h=400&fit=crop',
    nivelOcupacao: 'livre' as const,
    bio: 'Acompanhante noturno com treinamento em primeiros socorros, oferecendo companhia e segurança durante a noite.',
    formacao: 'Curso Técnico · Primeiros Socorros',
    areasAtuacao: ['Companhia noturna', 'Primeiros socorros', 'Monitoramento do sono'],
    disponibilidade: 'Todas as noites, 20h às 7h',
    diasDisponiveis: [0, 1, 2, 3, 4, 5, 6],
    horarioInicio: '20:00',
    horarioFim: '07:00',
    valorVisita: 140,
    telefone: '11954321098',
  },
];

async function main() {
  for (const profissional of profissionais) {
    await prisma.profissional.upsert({
      where: { id: profissional.id },
      create: profissional,
      update: profissional,
    });
  }
  console.log(`Seed concluído: ${profissionais.length} profissionais.`);

  // Liga o perfil de catálogo `prof-2` à conta de teste de cuidador. Sem dono, ninguém consegue
  // aceitar/iniciar/concluir as solicitações feitas para ele — as rotas de /cuidador autorizam
  // justamente por `profissionais.usuarioId` (ver migration 20260910201500).
  //
  // `prof-2` de propósito: é o mesmo profissional da solicitação de teste `sol-1` abaixo, então o
  // membro e o cuidador de teste enxergam OS DOIS LADOS da mesma contratação — que é como o
  // produto funciona (mesma linha, visões diferentes).
  //
  // Silencioso se a conta ainda não existir: o seed não cria usuários (senha precisa de hash pelo
  // fluxo real), então rode antes o cadastro de `cuidador@teste.com` pelo app ou por
  // `POST /auth/cadastro-cuidador`.
  const EMAIL_CUIDADOR_TESTE = 'cuidador@teste.com';
  const contaCuidadorTeste = await prisma.usuario.findUnique({
    where: { email: EMAIL_CUIDADOR_TESTE },
  });
  if (!contaCuidadorTeste) {
    console.log(
      `Aviso: conta ${EMAIL_CUIDADOR_TESTE} não existe — perfil prof-2 segue sem dono. ` +
        'Crie a conta e rode o seed de novo para poder testar o lado do cuidador.'
    );
  } else if (contaCuidadorTeste.tipo !== 'cuidador') {
    console.log(`Aviso: ${EMAIL_CUIDADOR_TESTE} não é uma conta de cuidador — prof-2 segue sem dono.`);
  } else {
    // Limpa um vínculo anterior em outro perfil: `usuarioId` é único, uma conta tem no máximo um
    // perfil público. Sem isso, rodar o seed depois de trocar de perfil daria erro de unicidade.
    await prisma.profissional.updateMany({
      where: { usuarioId: contaCuidadorTeste.id, NOT: { id: 'prof-2' } },
      data: { usuarioId: null },
    });
    await prisma.profissional.update({
      where: { id: 'prof-2' },
      data: { usuarioId: contaCuidadorTeste.id },
    });
    console.log(`Perfil prof-2 ligado à conta ${EMAIL_CUIDADOR_TESTE}.`);
  }

  // Solicitação de teste para o sistema de GPS em tempo real — mesmo id (`sol-1`) do mock em
  // vida-plena-app/src/contexts/AppContext.tsx, servindo de ponte entre o app e o banco real
  // enquanto não existe autenticação/identidade real ligando os dois lados.
  // Reseta todos os campos de teste a cada execução do seed — rodar de novo é como reiniciar o
  // teste do fluxo de aviso 30min/15min do zero, sem esperar um ciclo real inteiro.
  const inicioEm = new Date(Date.now() + (AVISO_MINUTOS_ANTES + 1) * 60 * 1000);
  const HORAS_TESTE = 3;
  const fimEm = new Date(inicioEm.getTime() + HORAS_TESTE * 60 * 60 * 1000);
  const valorHora = profissionais.find((p) => p.id === 'prof-2')!.valorVisita;

  // A contratação de teste também precisa pertencer à conta de MEMBRO de teste: `GET /solicitacoes`
  // filtra pelo dono, então sem isso só o cuidador enxergaria a contratação. Os dois lados têm que
  // ver a mesma linha — é assim que o produto funciona.
  const EMAIL_MEMBRO_TESTE = 'membro@teste.com';
  const contaMembroTeste = await prisma.usuario.findUnique({ where: { email: EMAIL_MEMBRO_TESTE } });
  if (!contaMembroTeste) {
    console.log(
      `Aviso: conta ${EMAIL_MEMBRO_TESTE} não existe — a solicitação de teste fica sem dono e não ` +
        'aparece na lista do membro. Crie a conta e rode o seed de novo.'
    );
  }

  const dadosSolicitacaoTeste = {
    cuidadorId: 'prof-2',
    usuarioId: contaMembroTeste?.id ?? null,
    membroNome: contaMembroTeste?.nome ?? 'Maria Oliveira',
    status: 'aceita' as const,
    inicioEm,
    fimEm,
    valorHora,
    valorTotal: valorHora * HORAS_TESTE,
    observacoes: 'Cuidado para minha mãe, que tem mobilidade reduzida.',
    avisoEnviadoEm: null,
    compartilhamentoAutorizado: false,
    ultimaLatitude: null,
    ultimaLongitude: null,
    atualizadoEm: null,
  };
  await prisma.solicitacao.upsert({
    where: { id: 'sol-1' },
    create: { id: 'sol-1', ...dadosSolicitacaoTeste },
    update: dadosSolicitacaoTeste,
  });

  // Cobrança da solicitação de teste, no estado em que o app espera encontrá-la: aceita e
  // aguardando o membro pagar (é o pagamento que libera a visita — ver DEV-NOTES.md 2026-09-10).
  const dadosPagamentoTeste = {
    valor: valorHora * HORAS_TESTE,
    forma: null,
    status: 'pendente' as const,
    pagoEm: null,
    liberadoEm: null,
  };
  await prisma.pagamento.upsert({
    where: { solicitacaoId: 'sol-1' },
    create: { solicitacaoId: 'sol-1', ...dadosPagamentoTeste },
    update: dadosPagamentoTeste,
  });

  console.log(
    `Seed concluído: solicitação de teste "sol-1" (${inicioEm.toLocaleString('pt-BR')} às ` +
      `${fimEm.toLocaleTimeString('pt-BR')}, R$ ${(valorHora * HORAS_TESTE).toFixed(2)} a pagar).`
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
