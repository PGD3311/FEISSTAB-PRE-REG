import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string
    pgTemplateDb: string
  }
}

const ROOT = process.cwd()
const TEMPLATE_DB = 'runfeis_template'

function pgBin(name: string): string {
  const dir =
    process.env.PG_BIN ??
    path.join(execFileSync('brew', ['--prefix', 'postgresql@17'], { encoding: 'utf8' }).trim(), 'bin')
  return path.join(dir, name)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('Could not find a free port'))
      })
    })
  })
}

async function waitForPostgres(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const client = new Client({ connectionString: url })
    try {
      await client.connect()
      await client.end()
      return
    } catch {
      await client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Postgres did not start at ${url}`)
}

function migrationFiles(): string[] {
  const dir = path.join(ROOT, 'supabase/migrations')
  return readdirSync(dir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => path.join(dir, name))
}

export default async function setup(project: TestProject) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'runfeis-pg-'))
  execFileSync(
    pgBin('initdb'),
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'],
    { stdio: 'ignore' }
  )
  const port = await freePort()
  const server: ChildProcess = spawn(
    pgBin('postgres'),
    ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1',
     '-c', 'unix_socket_directories=', '-c', 'fsync=off'],
    { stdio: 'ignore' }
  )

  const stop = async () => {
    if (server.exitCode === null) {
      server.kill('SIGINT')
      await new Promise((resolve) => server.once('exit', resolve))
    }
    rmSync(dataDir, { recursive: true, force: true })
  }

  try {
    const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`
    await waitForPostgres(adminUrl)

    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`)
    await admin.end()

    const template = new Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/${TEMPLATE_DB}` })
    await template.connect()
    try {
      await template.query(readFileSync(path.join(ROOT, 'tests/db/sql/supabase-standins.sql'), 'utf8'))
      for (const file of migrationFiles()) {
        try {
          await template.query(readFileSync(file, 'utf8'))
        } catch (err) {
          throw new Error(`${path.basename(file)} failed: ${(err as Error).message}`)
        }
      }
    } finally {
      // Close before any shutdown, so a failed migration reports its own message
      // instead of the server's "terminating connection" error crashing the run
      await template.end()
    }

    project.provide('pgAdminUrl', adminUrl)
    project.provide('pgTemplateDb', TEMPLATE_DB)
  } catch (err) {
    await stop()
    throw err
  }

  return stop
}
