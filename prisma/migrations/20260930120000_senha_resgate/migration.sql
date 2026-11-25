-- AlterTable
ALTER TABLE "cuidadores" ADD COLUMN     "senhaResgateBloqueadaAte" TIMESTAMP(3),
ADD COLUMN     "senhaResgateHash" TEXT,
ADD COLUMN     "senhaResgateTentativas" INTEGER NOT NULL DEFAULT 0;

