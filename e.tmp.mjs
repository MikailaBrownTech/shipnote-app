import fs from 'node:fs'
let p = 'src/server/github-projects.ts'
let s = fs.readFileSync(p, 'utf8')
const must = (from, to) => { if (!s.includes(from)) throw new Error('missing: ' + from.slice(0, 60)); s = s.replace(from, () => to) }
must("import { getProject } from './projects'", "import { getProject, listProjects } from './projects'")
must("  | 'not_found' // no such project of theirs\n  | 'rate_limited'\n  | 'unavailable'\n  | 'failed'\n", "  | 'not_found' // no such project of theirs\n  | 'already_linked' // another of the user's projects already uses this repository\n  | 'rate_limited'\n  | 'unavailable'\n  | 'failed'\n")
must("export type LinkResult =", `// Which repositories the user's projects are already linked to, by lower-cased
// name (GitHub treats names as case-insensitive), with the project that holds
// each. null if the projects could not be read.
export async function linkedRepos(
  userId: string,
): Promise<Map<string, string> | null> {
  const projects = await listProjects(userId)
  if (!projects.ok) return null
  const linked = new Map<string, string>()
  for (const project of projects.value) {
    if (project.repoFullName) {
      linked.set(project.repoFullName.toLowerCase(), project.id)
    }
  }
  return linked
}

export type LinkResult =`)
must("  let repos: string[]\n  try {", `  // The same repository cannot be linked to two of the user's projects (the
  // database enforces it too). Linking a project to its own repository again
  // is fine.
  const linked = await linkedRepos(input.userId)
  if (linked === null) return 'failed'
  const holder = linked.get(input.repoFullName.toLowerCase())
  if (holder !== undefined && holder !== input.projectId) {
    return 'already_linked'
  }

  let repos: string[]
  try {`)
fs.writeFileSync(p, s)

p = 'src/server/github-projects.test.ts'
s = fs.readFileSync(p, 'utf8')
must("const getProject = vi.fn()\n", "const getProject = vi.fn()\nconst listProjects = vi.fn()\n")
must("vi.mock('./projects', () => ({ getProject }))", "vi.mock('./projects', () => ({ getProject, listProjects }))")
must("  getProject.mockResolvedValue(linked())\n", "  getProject.mockResolvedValue(linked())\n  listProjects.mockResolvedValue({ ok: true, value: [] })\n")
fs.writeFileSync(p, s)
