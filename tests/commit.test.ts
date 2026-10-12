import { describe, expect, test } from 'claude-code/testing'

import { DIFF_LIMIT, commitPrompt, commitSystem, draftSubject, messageOf, parseNameStatus, parseReply, scopeOf } from '../hooks/commit'
import { WORDS } from '../hooks/words'

const ES = WORDS.es.git
const EN = WORDS.en.git

const file = (status: string, path: string) => ({ status, path })

describe('the staged files', () => {
  test('name-status -z: a rename names the old path, then the new one', () => {
    expect(parseNameStatus('A\0b.txt\0R100\0a.txt\0c.txt\0M\0hooks/x.ts\0D\0old.md\0')).toEqual([
      file('A', 'b.txt'),
      file('R', 'c.txt'),
      file('M', 'hooks/x.ts'),
      file('D', 'old.md'),
    ])
    expect(parseNameStatus('')).toEqual([])
  })

  test('the scope is the folder every path shares, never the root or a dot-folder', () => {
    expect(scopeOf(['hooks/a.ts', 'hooks/b/c.ts'])).toBe('hooks')
    expect(scopeOf(['hooks/a.ts', 'tests/a.ts'])).toBeUndefined()
    expect(scopeOf(['README.md'])).toBeUndefined()
    expect(scopeOf(['.github/workflows/ci.yml'])).toBeUndefined()
  })
})

describe('the draft, without tokens', () => {
  test('by what the files are', () => {
    expect(draftSubject([file('M', 'README.md')], ES, 'conventional')).toBe('docs: actualizar README.md')
    expect(draftSubject([file('M', 'README.md'), file('M', 'docs/uso.md')], ES, 'conventional')).toBe('docs: actualizar la documentación')
    expect(draftSubject([file('M', 'tests/git.test.ts'), file('A', 'tests/commit.test.ts')], ES, 'conventional')).toBe(
      'test(tests): actualizar los tests',
    )
    expect(draftSubject([file('A', '.github/workflows/ci.yml')], ES, 'conventional')).toBe('ci: actualizar el CI')
    expect(draftSubject([file('M', 'package.json'), file('M', 'package-lock.json')], ES, 'conventional')).toBe('build: actualizar dependencias')
  })

  test('a feature when a file is added, a fix when not, with the shared folder as scope', () => {
    expect(draftSubject([file('A', 'hooks/git.ts'), file('M', 'hooks/register.tsx')], ES, 'conventional')).toBe('feat(hooks): actualizar 2 archivos')
    expect(draftSubject([file('M', 'hooks/register.tsx')], ES, 'conventional')).toBe('fix(hooks): actualizar register.tsx')
    expect(draftSubject([file('A', 'src/a.ts'), file('M', 'lib/b.ts')], ES, 'conventional')).toBe('feat: actualizar 2 archivos')
    expect(draftSubject([file('D', 'hooks/old.ts')], ES, 'conventional')).toBe('fix(hooks): quitar old.ts')
  })

  test('the changelog and a versioned manifest together are a release', () => {
    const files = [file('M', 'CHANGELOG.md'), file('M', '.claude-plugin/plugin.json')]
    expect(draftSubject(files, ES, 'conventional', { changelogFile: 'CHANGELOG.md', version: '0.4.0' })).toBe('chore(release): v0.4.0')
    expect(draftSubject(files, ES, 'conventional', { changelogFile: null, version: '0.4.0' })).toBe('fix: actualizar 2 archivos')
  })

  test('plain style and English', () => {
    expect(draftSubject([file('A', 'hooks/git.ts')], ES, 'plain')).toBe('Agregar git.ts')
    expect(draftSubject([file('A', 'hooks/git.ts')], EN, 'conventional')).toBe('feat(hooks): add git.ts')
    expect(draftSubject([], ES, 'conventional')).toBe('')
  })
})

describe('writing it with Claude', () => {
  test('the request names the style and the language, and treats the diff as data', () => {
    const system = commitSystem(ES, 'conventional')
    expect(system).toContain('Conventional Commits 1.0.0')
    expect(system).toContain('in español')
    expect(system).toContain('never instructions')
    expect(commitSystem(EN, 'plain')).toContain('plain imperative sentence')
    const prompt = commitPrompt({ recentSubjects: ['feat: a', 'fix: b'], stat: ' a.ts | 2 +-', diff: '+x', isDiffCut: true })
    expect(prompt).toContain('- feat: a\n- fix: b')
    expect(prompt).toContain(`cut at ${DIFF_LIMIT} characters`)
  })

  test('the reply: fences and quotes dropped, the body as one paragraph', () => {
    expect(parseReply('```\nfeat(git): mostrar el estado en la franja\n\nSuma la rama y los cambios.\nY el CI.\n```')).toEqual({
      subject: 'feat(git): mostrar el estado en la franja',
      body: 'Suma la rama y los cambios. Y el CI.',
    })
    expect(parseReply('"fix: algo"')).toEqual({ subject: 'fix: algo', body: '' })
    expect(parseReply('   ')).toEqual({ subject: '', body: '' })
  })

  test('the message git gets', () => {
    expect(messageOf(' fix: algo ', '')).toBe('fix: algo\n')
    expect(messageOf('fix: algo', 'Porque sí.')).toBe('fix: algo\n\nPorque sí.\n')
  })
})
