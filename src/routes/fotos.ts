import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { autenticar, autenticarImagem } from '../auth/middleware';
import { rotaAsync } from '../lib/rotaAsync';
import { decodificarJpeg, ErroImagem, lerImagem, salvarImagem } from '../lib/armazenamento';

export const fotosRouter = Router();

// Foto de perfil (fluxo definido pelo usuário em 2026-09-30, ver o Cérebro):
// - profissional: a selfie tirada pela câmera na Verificação profissional; é a referência para
//   conferir o rosto ao iniciar cada atendimento (lib/verificacaoFacial.ts);
// - membro: câmera ou galeria, em Meu Perfil.
// A restrição "profissional só pela câmera, só na verificação" hoje é da tela do app; o servidor
// não sabe de onde veio a foto. Com a API facial + Cloudflare R2 isso passa a ser validado aqui.
//
// Esta é a ÚNICA forma de mudar a foto: `PUT /membro/perfil` e `PUT /cuidador/perfil` não aceitam
// um endereço de foto vindo do app (a foto sempre passa por aqui, JPEG até 3 MB).
fotosRouter.post('/perfil', autenticar, rotaAsync(async (req, res) => {
  let imagem: Buffer;
  try {
    imagem = decodificarJpeg(req.body?.imagemBase64);
  } catch (erro) {
    if (erro instanceof ErroImagem) {
      res.status(400).json({ erro: erro.message });
      return;
    }
    throw erro;
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuarioId! },
    include: { perfilProfissional: { select: { id: true } }, membro: { select: { id: true } } },
  });
  if (!usuario) {
    res.status(404).json({ erro: 'Usuário não encontrado' });
    return;
  }

  const chave = await salvarImagem('perfil', imagem);
  const agora = new Date();
  await prisma.$transaction([
    prisma.usuario.update({ where: { id: usuario.id }, data: { fotoPerfil: chave, fotoPerfilEm: agora } }),
    // Espelha onde as telas já leem a foto: catálogo (cuidador) e perfil de saúde (membro).
    ...(usuario.perfilProfissional
      ? [prisma.profissional.update({ where: { id: usuario.perfilProfissional.id }, data: { foto: chave } })]
      : []),
    ...(usuario.tipo === 'membro'
      ? [
          prisma.membro.upsert({
            where: { usuarioId: usuario.id },
            create: { usuarioId: usuario.id, fotoUrl: chave },
            update: { fotoUrl: chave },
          }),
        ]
      : []),
  ]);
  res.status(201).json({ fotoPerfil: chave, fotoPerfilEm: agora });
}));

// Qualquer pessoa logada vê fotos de perfil: o membro precisa ver o rosto do cuidador antes de
// contratar, e o cuidador o de quem vai atender.
fotosRouter.get('/perfil/:arquivo', autenticarImagem, rotaAsync(async (req, res) => {
  const imagem = await lerImagem(`perfil/${req.params.arquivo}`);
  if (!imagem) {
    res.status(404).json({ erro: 'Foto não encontrada' });
    return;
  }
  res.type('image/jpeg').set('Cache-Control', 'private, max-age=86400').send(imagem);
}));

// Selfie de início de atendimento: só as duas pontas daquela contratação (o membro dono e o
// cuidador dono do perfil) podem ver.
fotosRouter.get('/selfie/:arquivo', autenticarImagem, rotaAsync(async (req, res) => {
  const chave = `selfie/${req.params.arquivo}`;
  const solicitacao = await prisma.solicitacao.findFirst({
    where: {
      selfieInicio: chave,
      OR: [{ usuarioId: req.usuarioId! }, { cuidador: { usuarioId: req.usuarioId! } }],
    },
    select: { id: true },
  });
  const imagem = solicitacao ? await lerImagem(chave) : null;
  if (!imagem) {
    res.status(404).json({ erro: 'Foto não encontrada' });
    return;
  }
  res.type('image/jpeg').set('Cache-Control', 'private, max-age=86400').send(imagem);
}));
