import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type FullConfig } from '@playwright/test'
import { rodarComoPostgres, supabaseLocal } from './apoio.ts'
import { ARQUIVO_DA_CAMERA, ROSTO_DA_CAMERA, gerarCameraFalsa } from './camera-falsa.ts'
import { PASTA_DOS_PRINTS, PRINTS } from './prints.ts'

/*
 * A PREPARAÇÃO DOS TESTES DE PONTA A PONTA (o `globalSetup` do Playwright).
 * Roda uma vez, antes de qualquer teste, e falha cedo com a frase do que
 * fazer:
 *
 *   1. o Supabase local de pé e com a estrutura do ponto aplicada;
 *   2. a câmera falsa: o rosto de `demo/rostos/` vira o arquivo que a webcam
 *      do Chrome mostra (ver `camera-falsa.ts`). Ela tem de existir ANTES de o
 *      navegador dos testes abrir, porque é na abertura que o Chrome lê o
 *      arquivo — por isso nasce aqui, num Chrome de passagem;
 *   3. com PRINTS=1, a pasta dos prints recomeça (só os .png dela saem).
 */
export default async function preparar(config: FullConfig): Promise<void> {
  supabaseLocal()
  const estrutura = rodarComoPostgres(
    "SELECT to_regclass('public.ponto_super_admins') IS NOT NULL AND to_regclass('public.ponto_registros') IS NOT NULL;",
  ).trim()
  if (estrutura !== 't') {
    throw new Error('A estrutura do ponto não está no banco do Supabase local. Recrie o banco com `npm run db:zerar`.')
  }

  const canal = config.projects[0]?.use.channel
  const navegador = await chromium.launch({ channel: canal })
  try {
    await gerarCameraFalsa(navegador, ROSTO_DA_CAMERA, ARQUIVO_DA_CAMERA)
  } finally {
    await navegador.close()
  }

  if (PRINTS) {
    mkdirSync(PASTA_DOS_PRINTS, { recursive: true })
    for (const arquivo of readdirSync(PASTA_DOS_PRINTS)) {
      if (arquivo.endsWith('.png')) rmSync(join(PASTA_DOS_PRINTS, arquivo))
    }
  }
}
