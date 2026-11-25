import { Router } from 'express';
import type { CategoriaCuidador, TipoDocumentoCadastro } from '@prisma/client';
import { autenticacaoOpcional } from '../auth/middleware';
import { prisma } from '../lib/prisma';
import { avaliarCadastro } from '../validacao/regras';
import { rotaAsync } from '../lib/rotaAsync';

export const cuidadoresCadastroRouter = Router();

const CATEGORIAS: CategoriaCuidador[] = ['cuidador', 'tecnico', 'enfermeiro'];
const TIPOS_DOCUMENTO: TipoDocumentoCadastro[] = [
  'rg_cnh',
  'comprovante_endereco',
  'antecedentes_criminais',
  'certificado_cuidador',
  'coren_comprovante',
  'diploma',
  'situacao_cadastral',
];

function ehCategoriaValida(valor: unknown): valor is CategoriaCuidador {
  return typeof valor === 'string' && (CATEGORIAS as string[]).includes(valor);
}

function ehListaDeDocumentosValida(valor: unknown): valor is TipoDocumentoCadastro[] {
  return Array.isArray(valor) && valor.every((item) => typeof item === 'string' && (TIPOS_DOCUMENTO as string[]).includes(item));
}

interface QuizRespostaBody {
  questaoId: string;
  respostaId: string;
  correta: boolean;
  critica: boolean;
}

function ehListaDeRespostasValida(valor: unknown): valor is QuizRespostaBody[] {
  return (
    Array.isArray(valor) &&
    valor.every(
      (item) =>
        item &&
        typeof item.questaoId === 'string' &&
        typeof item.respostaId === 'string' &&
        typeof item.correta === 'boolean' &&
        typeof item.critica === 'boolean'
    )
  );
}

// Cadastro/aprovação de cuidador — verificação profissional pesada, opcional (ver DEV-NOTES.md
// 2026-08-15: a conta em si já existe antes disso, via /auth/cadastro-cuidador). Decisão
// automática via motor de regras (src/validacao/), sem aprovação manual da equipe. `cpf` único:
// reenviar com o mesmo CPF (ex.: depois de corrigir um motivo de reprovação) substitui o cadastro
// anterior por completo.
//
// Autenticação é opcional aqui de propósito (mantém funcionando sem conta, como em 2026-08-14):
// com um token válido, nome/telefone/email/categoria vêm da conta (não do corpo da requisição, pra
// não deixar o cliente reescrever esses dados por engano) e o resultado é espelhado no `Cuidador`
// da conta; sem token, continua exigindo esses campos no corpo, como antes.
cuidadoresCadastroRouter.post('/', autenticacaoOpcional, rotaAsync(async (req, res) => {
  const usuarioAutenticado = req.usuarioId
    ? await prisma.usuario.findUnique({ where: { id: req.usuarioId }, include: { cuidador: true } })
    : null;

  const body = req.body ?? {};
  const nome = usuarioAutenticado?.nome ?? body.nome;
  const telefone = usuarioAutenticado?.telefone ?? body.telefone;
  const email = usuarioAutenticado?.email ?? body.email;
  const categoria = usuarioAutenticado?.cuidador?.categoria ?? body.categoria;
  const { cpf, corenNumero, chavePix, aceiteResponsabilidade, documentosEnviados, quizRespostas } = body;

  if (
    typeof nome !== 'string' ||
    !nome.trim() ||
    typeof cpf !== 'string' ||
    !cpf.trim() ||
    typeof telefone !== 'string' ||
    !telefone.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof chavePix !== 'string' ||
    !chavePix.trim() ||
    typeof aceiteResponsabilidade !== 'boolean' ||
    !ehCategoriaValida(categoria) ||
    !ehListaDeDocumentosValida(documentosEnviados) ||
    !ehListaDeRespostasValida(quizRespostas)
  ) {
    res.status(400).json({ erro: 'Payload de cadastro inválido' });
    return;
  }

  const corenNumeroNormalizado = typeof corenNumero === 'string' && corenNumero.trim() ? corenNumero.trim() : null;

  const resultado = await avaliarCadastro({
    cpf,
    categoria,
    corenNumero: corenNumeroNormalizado,
    chavePix,
    aceiteResponsabilidade,
    documentosEnviados,
    quizRespostas,
  });

  const cadastro = await prisma.$transaction(async (tx) => {
    // Cascade delete (onDelete: Cascade em CadastroDocumento/CadastroQuizResposta) já limpa
    // documentos/respostas antigos junto com o cadastro anterior, se existir — por CPF (reenvio
    // comum) ou por conta (se a pessoa tiver corrigido o CPF entre uma tentativa e outra).
    await tx.cadastroCuidador.deleteMany({
      where: usuarioAutenticado ? { OR: [{ cpf }, { usuarioId: usuarioAutenticado.id }] } : { cpf },
    });

    const criado = await tx.cadastroCuidador.create({
      data: {
        usuarioId: usuarioAutenticado?.id ?? null,
        nome,
        cpf,
        telefone,
        email,
        categoria,
        corenNumero: corenNumeroNormalizado,
        chavePix,
        statusVerificacao: resultado.statusVerificacao,
        motivos: resultado.motivos,
        documentos: { create: documentosEnviados.map((tipo) => ({ tipo })) },
        quizRespostas: {
          create: quizRespostas.map((resposta) => ({
            questaoId: resposta.questaoId,
            respostaId: resposta.respostaId,
            correta: resposta.correta,
            critica: resposta.critica,
          })),
        },
      },
    });

    if (usuarioAutenticado?.cuidador) {
      await tx.cuidador.update({
        where: { usuarioId: usuarioAutenticado.id },
        data: {
          categoria,
          corenNumero: corenNumeroNormalizado,
          chavePix,
          statusVerificacao: resultado.statusVerificacao,
          motivos: resultado.motivos,
        },
      });
    }

    return criado;
  });

  res.status(201).json({ id: cadastro.id, statusVerificacao: cadastro.statusVerificacao, motivos: cadastro.motivos });
}));

cuidadoresCadastroRouter.get('/:id', rotaAsync(async (req, res) => {
  const cadastro = await prisma.cadastroCuidador.findUnique({ where: { id: req.params.id } });
  if (!cadastro) {
    res.status(404).json({ erro: 'Cadastro não encontrado' });
    return;
  }
  res.json(cadastro);
}));
