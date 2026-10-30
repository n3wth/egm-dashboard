import { acceptInvitation, ApiError, collectProject, createProject, listGithubRepositories, metricCards, readJson, renameProject, selectGithubRepository, snapshotFreshness, sourceStatus, startGithubInstall, updatePresentation, updateWebsite, websiteMetric } from './api.mjs'
import { createWorkspaceMembers } from './members.mjs'
import { createWorkspaceInvitations } from './invitations.mjs'
import { createWorkspaceAudit } from './audit.mjs'
import { createProjectHistory } from './history.mjs'
import { createProjectArchive } from './archive.mjs'
import { createCollectionStatus } from './collection-status.mjs'
import { createWorkspaceExport } from './workspace-export.mjs'

const element = id => document.getElementById(id)
const workspaceMembers = createWorkspaceMembers({ section: element('workspace-members'), status: element('workspace-members-status'), list: element('workspace-members-list'), document })
const workspaceInvitations = createWorkspaceInvitations({ section: element('workspace-invitations'), status: element('workspace-invitations-status'), list: element('workspace-invitations-list'), document })
const workspaceAudit = createWorkspaceAudit({ section: element('workspace-audit'), status: element('workspace-audit-status'), list: element('workspace-audit-list'), document })
const projectHistory = createProjectHistory({ section: element('project-history'), status: element('history-status'), charts: element('history-charts'), document })
const projectArchive = createProjectArchive({ document, section: element('archived-projects'), status: element('archived-status'), list: element('archived-list'), controls: element('project-archive'), message: element('archive-status'), archive: element('archive-button'), confirm: element('archive-confirm'), cancel: element('archive-cancel'), onChanged: id => loadProjects(id) })
const projectList = element('project-list')
const workspaceSelect = element('workspace-select')
const workspaceStatus = element('workspace-status')
const retryWorkspaces = element('retry-workspaces')
const projectsStatus = element('projects-status')
const retryProjects = element('retry-projects')
const empty = element('project-empty')
const detail = element('project-detail')
const detailStatus = element('detail-status')
const metrics = element('metrics')
const exportButton = element('export-project')
const exportStatus = element('export-status')
const websiteSettings = element('website-settings')
const websiteForm = element('website-form')
const websiteUrl = element('website-url')
const websiteSave = element('website-save')
const websiteStatus = element('website-status')
const invitationForm = element('invitation-form')
const invitationToken = element('invitation-token')
const invitationSubmit = element('invitation-submit')
const invitationStatus = element('invitation-status')
const createSection = element('create-project-section')
const workspaceExport = createWorkspaceExport({ document, anchor: createSection })
const createForm = element('create-project-form')
const createName = element('create-project-name')
const createSubmit = element('create-project-submit')
const createStatus = element('create-project-status')
const presentationSettings = element('presentation-settings')
const presentationForm = element('presentation-form')
const presentationTitle = element('presentation-title')
const presentationDescription = element('presentation-description')
const presentationSave = element('presentation-save')
const presentationStatus = element('presentation-status')
let workspaceRoles = new Map()
let selected = null
let savedPresentation = null
let projectController
let exportController
let listController
let workspaceController
let websiteController
let presentationController
let createController
let accessController
let githubController
let aiController
let renameController
let collectionController

const aiSection = document.createElement('section')
aiSection.className = 'info'
aiSection.hidden = true
const aiHeading = document.createElement('h3')
aiHeading.textContent = 'AI guidance'
const aiDisclosure = document.createElement('p')
const aiStatus = document.createElement('p')
aiStatus.setAttribute('role', 'status')
aiStatus.setAttribute('aria-live', 'polite')
const aiConsentLabel = document.createElement('label')
aiConsentLabel.className = 'ai-consent'
const aiConsent = document.createElement('input')
aiConsent.type = 'checkbox'
const aiConsentText = document.createElement('span')
aiConsentText.textContent = 'I have reviewed this disclosure for my workspace.'
aiConsentLabel.append(aiConsent, aiConsentText)
const aiSettings = document.createElement('button')
aiSettings.type = 'button'
const aiForm = document.createElement('form')
aiForm.hidden = true
const aiFocusLabel = document.createElement('label')
aiFocusLabel.setAttribute('for', 'ai-focus')
aiFocusLabel.textContent = 'What would you like to understand? (optional)'
const aiFocus = document.createElement('textarea')
aiFocus.id = 'ai-focus'
aiFocus.rows = 2
aiFocus.maxLength = 800
const aiSubmit = document.createElement('button')
aiSubmit.type = 'submit'
aiSubmit.textContent = 'Generate insight'
const aiResult = document.createElement('p')
aiResult.className = 'ai-result'
const aiSource = document.createElement('p')
aiForm.append(aiFocusLabel, aiFocus, aiSubmit, aiResult, aiSource)
aiSection.append(aiHeading, aiDisclosure, aiStatus, aiConsentLabel, aiSettings, aiForm)

function clearAi() {
  aiController?.abort()
  aiSection.hidden = true
  aiForm.hidden = true
  aiConsent.checked = false
  aiConsentLabel.hidden = true
  aiSettings.hidden = true
  aiSettings.disabled = false
  aiSubmit.disabled = false
  aiFocus.value = ''
  text(aiDisclosure, '')
  text(aiStatus, '')
  text(aiResult, '')
  text(aiSource, '')
}

async function loadAi(projectId, organizationId) {
  clearAi()
  const controller = new AbortController()
  aiController = controller
  const owner = workspaceRoles.get(organizationId) === 'owner'
  aiSection.hidden = false
  text(aiStatus, 'Loading AI settings…')
  try {
    const settings = await readJson('/api/boing/ai-settings', { organizationId, signal: controller.signal })
    if (controller.signal.aborted) return
    if (typeof settings?.enabled !== 'boolean' || typeof settings?.available !== 'boolean') throw new Error('invalid settings')
    const disclosure = settings.disclosure
    if (disclosure && (typeof disclosure.text !== 'string' || !/^[a-f0-9]{64}$/.test(disclosure.id ?? ''))) throw new Error('invalid disclosure')
    text(aiDisclosure, disclosure?.text ?? '')
    const ready = settings.enabled && settings.available && !!disclosure
    aiForm.hidden = !ready
    aiSettings.hidden = !owner || (!settings.enabled && (!settings.available || !disclosure))
    aiConsentLabel.hidden = !owner || settings.enabled || !settings.available || !disclosure
    aiSettings.textContent = settings.enabled ? 'Disable AI for workspace' : 'Enable AI for workspace'
    text(aiStatus, ready ? 'Enabled for this workspace.' : !settings.available ? 'AI guidance is not configured for this workspace yet.' : settings.enabled ? 'The processor disclosure changed. An owner must review it before AI can be used.' : 'AI guidance is off for this workspace.')
    aiSettings.onclick = async () => {
      if (controller.signal.aborted || aiSettings.disabled) return
      if (!settings.enabled && !aiConsent.checked) { text(aiStatus, 'Review and acknowledge the disclosure before enabling AI.'); return }
      aiSettings.disabled = true
      text(aiStatus, 'Saving AI settings…')
      try {
        const response = await fetch('/api/boing/ai-settings', {
          method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
          body: JSON.stringify(settings.enabled ? { enabled: false } : { enabled: true, disclosureId: disclosure.id }),
        })
        if (!response.ok || typeof (await response.json())?.enabled !== 'boolean') throw new Error('save failed')
        if (!controller.signal.aborted) await loadAi(projectId, organizationId)
      } catch { if (!controller.signal.aborted) { aiSettings.disabled = false; text(aiStatus, 'Could not save AI settings. Refresh and review the disclosure again.') } }
    }
    aiForm.onsubmit = async event => {
      event.preventDefault()
      if (controller.signal.aborted || aiSubmit.disabled || !ready) return
      aiSubmit.disabled = true
      text(aiResult, '')
      text(aiSource, '')
      text(aiStatus, 'Generating insight…')
      try {
        const response = await fetch('/api/boing/insights', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
          body: JSON.stringify({ projectId, focus: aiFocus.value.trim() }),
        })
        if (!response.ok) throw new Error('insight unavailable')
        const result = await response.json()
        if (controller.signal.aborted) return
        if (result?.projectId !== projectId || typeof result.insight !== 'string' || result.insight.length > 4000) throw new Error('invalid insight')
        text(aiResult, result.insight)
        const date = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : 'date unavailable'
        const sources = Array.isArray(result.sources) ? result.sources.filter(item => ['github', 'website'].includes(item?.kind)).map(item => `${item.kind === 'github' ? 'GitHub' : 'Website'} (${date(item.generatedAt)})`) : []
        if (result.snapshotAt) sources.unshift(`Stored snapshot (${date(result.snapshotAt)})`)
        text(aiSource, `Project data available: ${sources.length ? sources.join(', ') : 'date unavailable'}.${result.contextTruncated ? ' Some data was omitted from the AI context.' : ''} AI can make mistakes; check the underlying data before acting.`)
        text(aiStatus, '')
      } catch { if (!controller.signal.aborted) text(aiStatus, 'Could not generate an insight. Check that data and AI guidance are available, then try again.') }
      finally { if (!controller.signal.aborted) aiSubmit.disabled = false }
    }
  } catch { if (!controller.signal.aborted) text(aiStatus, 'Could not load AI settings. Select the project again to retry.') }
}

const githubSection = document.createElement('section')
githubSection.className = 'info'
githubSection.hidden = true
const githubHeading = document.createElement('h3')
githubHeading.textContent = 'GitHub repository'
const githubDescription = document.createElement('p')
githubDescription.textContent = 'Connect a repository to track its activity. GitHub lets you choose which repositories Boing can access.'
const githubConnect = document.createElement('button')
githubConnect.type = 'button'
githubConnect.textContent = 'Connect GitHub'
const githubStatus = document.createElement('p')
githubStatus.setAttribute('role', 'status')
githubStatus.setAttribute('aria-live', 'polite')
const githubForm = document.createElement('form')
githubForm.hidden = true
const githubLabel = document.createElement('label')
githubLabel.textContent = 'Repository'
githubLabel.setAttribute('for', 'github-repository')
const githubSelect = document.createElement('select')
githubSelect.id = 'github-repository'
const githubSave = document.createElement('button')
githubSave.type = 'submit'
githubSave.textContent = 'Connect repository'
githubForm.append(githubLabel, githubSelect, githubSave)
githubSection.append(githubHeading, githubDescription, githubConnect, githubStatus, githubForm)

function pendingGithub() {
  try {
    const value = JSON.parse(sessionStorage.getItem('boing.github.pending') || 'null')
    return value && /^[A-Za-z0-9_-]{1,128}$/.test(value.organizationId ?? '') && /^[A-Za-z0-9_-]{1,128}$/.test(value.projectId ?? '') ? value : null
  } catch { return null }
}

function clearGithub() {
  githubController?.abort()
  githubSection.hidden = true
  githubConnect.disabled = false
  githubForm.hidden = true
  githubSelect.replaceChildren()
  text(githubStatus, '')
}

async function loadGithub(project, organizationId) {
  clearGithub()
  if (!['owner', 'admin'].includes(workspaceRoles.get(organizationId))) return
  const controller = new AbortController()
  githubController = controller
  githubSection.hidden = false
  githubConnect.textContent = project.repository ? 'Change repository' : 'Connect GitHub'
  const pending = pendingGithub()
  if (pending?.organizationId !== organizationId || pending?.projectId !== project.id) return
  text(githubStatus, 'Loading available repositories…')
  try {
    const repositories = await listGithubRepositories(project.id, { organizationId, signal: controller.signal })
    if (controller.signal.aborted) return
    for (const repository of repositories) {
      const option = document.createElement('option')
      option.value = String(repository.id)
      text(option, `${repository.fullName}${repository.private ? ' (private)' : ''}`)
      githubSelect.append(option)
    }
    githubForm.hidden = repositories.length === 0
    text(githubStatus, repositories.length ? 'Choose a repository to finish connecting.' : 'No repositories are available in this installation.')
  } catch (error) {
    if (controller.signal.aborted) return
    const expired = error instanceof ApiError && error.status === 403
    if (expired) try { sessionStorage.removeItem('boing.github.pending') } catch {}
    text(githubStatus, expired ? 'GitHub authorization expired or was not completed. Connect again to continue.' : 'Could not load repositories. Try connecting again.')
  }
}

githubConnect.addEventListener('click', async () => {
  const project = selected?.project, organizationId = workspaceSelect.value
  const controller = githubController
  if (!project || !controller || controller.signal.aborted || githubConnect.disabled) return
  githubConnect.disabled = true
  text(githubStatus, 'Preparing GitHub connection…')
  try {
    const url = await startGithubInstall(project.id, { organizationId, signal: controller.signal })
    if (controller.signal.aborted) return
    sessionStorage.setItem('boing.github.pending', JSON.stringify({ organizationId, projectId: project.id }))
    window.location.assign(url)
  } catch (error) {
    if (!controller.signal.aborted) text(githubStatus, error instanceof ApiError && error.status === 503 ? 'GitHub connection is not configured yet.' : 'Could not start GitHub connection. Try again.')
  } finally { if (!controller.signal.aborted) githubConnect.disabled = false }
})

githubForm.addEventListener('submit', async event => {
  event.preventDefault()
  const project = selected?.project, organizationId = workspaceSelect.value, controller = githubController
  const repositoryId = Number(githubSelect.value)
  if (!project || !controller || controller.signal.aborted || githubSave.disabled || !Number.isSafeInteger(repositoryId) || repositoryId <= 0) return
  githubSave.disabled = true
  text(githubStatus, 'Connecting repository…')
  try {
    await selectGithubRepository(repositoryId, { organizationId, signal: controller.signal })
    if (controller.signal.aborted) return
    try { sessionStorage.removeItem('boing.github.pending') } catch {}
    githubForm.hidden = true
    text(githubStatus, 'Repository connected.')
    await loadProjects(project.id)
  } catch { if (!controller.signal.aborted) text(githubStatus, 'Could not connect this repository. Check access and try again.') }
  finally { githubSave.disabled = false }
})

// Workspace owners manage access to the selected project here. Access is
// always checked again by the server; this is only a presentation gate.
const accessSection = document.createElement('section')
accessSection.className = 'info'
accessSection.hidden = true
const accessHeading = document.createElement('h3')
accessHeading.textContent = 'Project access'
const accessDescription = document.createElement('p')
accessDescription.textContent = 'Choose which workspace members can view this project. Owners always have access.'
const accessStatus = document.createElement('p')
accessStatus.setAttribute('role', 'status')
accessStatus.setAttribute('aria-live', 'polite')
const accessList = document.createElement('div')
accessList.className = 'access-list'
accessSection.append(accessHeading, accessDescription, accessStatus, accessList)
detail.append(accessSection)
detail.append(githubSection)
detail.append(aiSection)
const renameSection = document.createElement('section')
renameSection.className = 'info'
renameSection.hidden = true
const renameHeading = document.createElement('h3')
renameHeading.textContent = 'Project name'
const renameForm = document.createElement('form')
const renameLabel = document.createElement('label')
renameLabel.textContent = 'Name'
renameLabel.setAttribute('for', 'rename-project-name')
const renameInput = document.createElement('input')
renameInput.id = 'rename-project-name'
renameInput.type = 'text'
renameInput.maxLength = 100
renameInput.required = true
const renameSave = document.createElement('button')
renameSave.type = 'submit'
renameSave.textContent = 'Save name'
const renameStatus = document.createElement('p')
renameStatus.setAttribute('role', 'status')
renameStatus.setAttribute('aria-live', 'polite')
renameForm.append(renameLabel, renameInput, renameSave, renameStatus)
renameSection.append(renameHeading, renameForm)
detail.append(renameSection)

const collectionSection = document.createElement('section')
collectionSection.className = 'info'
collectionSection.hidden = true
const collectionHeading = document.createElement('h3')
collectionHeading.textContent = 'Collect data'
const collectionDescription = document.createElement('p')
const collectionButton = document.createElement('button')
collectionButton.type = 'button'
collectionButton.textContent = 'Collect now'
const collectionStatus = document.createElement('p')
collectionStatus.setAttribute('role', 'status')
collectionStatus.setAttribute('aria-live', 'polite')
const runsStatus = document.createElement('p')
runsStatus.setAttribute('role', 'status')
runsStatus.setAttribute('aria-live', 'polite')
const runsList = document.createElement('ul')
const runsRefresh = document.createElement('button')
runsRefresh.type = 'button'
runsRefresh.textContent = 'Refresh run status'
const collectionRuns = createCollectionStatus({ status: runsStatus, list: runsList, refresh: runsRefresh, document })
collectionSection.append(collectionHeading, collectionDescription, collectionButton, collectionStatus, runsStatus, runsList, runsRefresh)
detail.append(collectionSection)

function clearAccess() {
  accessController?.abort()
  accessSection.hidden = true
  accessList.replaceChildren()
  text(accessStatus, '')
}

async function loadAccess(projectId, organizationId) {
  clearAccess()
  if (workspaceRoles.get(organizationId) !== 'owner') return
  const controller = new AbortController()
  accessController = controller
  accessSection.hidden = false
  text(accessStatus, 'Loading members…')
  try {
    const options = { signal: controller.signal, organizationId }
    const [memberData, accessData] = await Promise.all([
      readJson('/api/boing/members', options),
      readJson(`/api/boing/projects/${encodeURIComponent(projectId)}/access`, options),
    ])
    if (controller.signal.aborted) return
    if (!Array.isArray(memberData?.members) || !Array.isArray(accessData?.userIds)) throw new Error('invalid_members')
    const members = memberData.members.filter(member => /^user_[A-Za-z0-9]+$/.test(member?.user_id ?? '') && typeof member.email === 'string' && ['member', 'admin'].includes(member.role))
    const granted = new Set(accessData.userIds)
    if (memberData.truncated || accessData.truncated) {
      text(accessStatus, 'This workspace has too many members or grants to manage here.')
      return
    }
    text(accessStatus, members.length ? '' : 'No other active workspace members yet.')
    for (const member of members) {
      const row = document.createElement('div')
      row.className = 'access-row'
      const label = document.createElement('span')
      label.textContent = member.email
      const button = document.createElement('button')
      button.type = 'button'
      const updateLabel = () => { button.textContent = granted.has(member.user_id) ? 'Remove access' : 'Give access' }
      updateLabel()
      button.addEventListener('click', async () => {
        if (controller.signal.aborted || button.disabled) return
        const enabled = !granted.has(member.user_id)
        button.disabled = true
        text(accessStatus, 'Saving access…')
        try {
          const response = await fetch(`/api/boing/projects/${encodeURIComponent(projectId)}/access`, {
            method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
            headers: { accept: 'application/json', 'content-type': 'application/json', 'x-boing-organization': organizationId },
            body: JSON.stringify({ userId: member.user_id, enabled }),
          })
          if (!response.ok || (await response.json())?.updated !== true) throw new Error('update_failed')
          if (controller.signal.aborted) return
          if (enabled) granted.add(member.user_id); else granted.delete(member.user_id)
          updateLabel()
          text(accessStatus, 'Access updated.')
        } catch { if (!controller.signal.aborted) text(accessStatus, 'Could not update access. Check the member’s workspace access and try again.') }
        finally { button.disabled = false }
      })
      row.append(label, button)
      accessList.append(row)
    }
  } catch { if (!controller.signal.aborted) text(accessStatus, 'Could not load members. Select the project again to retry.') }
}

function text(node, value) { node.textContent = typeof value === 'string' ? value : '' }
function messageFor(error) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return 'Your session is unavailable or you no longer have access. Sign in again or contact your workspace owner.'
  if (error instanceof ApiError && error.status === 404) return 'This information is not available for this project.'
  return 'Could not load this information. Try again in a moment.'
}

function clearProjects() {
  workspaceExport.clear()
  projectHistory.clear()
  projectArchive.clear()
  workspaceMembers.clear()
  workspaceInvitations.clear()
  workspaceAudit.clear()
  clearAi()
  clearAccess()
  clearGithub()
  createController?.abort()
  createSection.hidden = true
  createSubmit.disabled = false
  text(createStatus, '')
  projectController?.abort()
  exportController?.abort()
  websiteController?.abort()
  renameController?.abort()
  collectionController?.abort()
  collectionRuns.clear()
  collectionSection.hidden = true
  collectionButton.disabled = true
  text(collectionStatus, '')
  renameSection.hidden = true
  renameSave.disabled = false
  text(renameStatus, '')
  presentationController?.abort()
  savedPresentation = null
  presentationSettings.hidden = true
  presentationSave.disabled = false
  text(presentationStatus, '')
  websiteSave.disabled = false
  websiteSettings.hidden = true
  text(websiteStatus, '')
  exportButton.disabled = false
  text(exportStatus, '')
  listController?.abort()
  selected = null
  detail.hidden = true
  empty.hidden = false
  metrics.replaceChildren()
  projectList.replaceChildren()
  retryProjects.hidden = true
  text(projectsStatus, '')
}

async function loadWorkspaces(preferredId, preferredProjectId) {
  workspaceController?.abort()
  const controller = new AbortController()
  workspaceController = controller
  clearProjects()
  workspaceSelect.disabled = true
  workspaceSelect.replaceChildren()
  workspaceRoles = new Map()
  retryWorkspaces.hidden = true
  text(workspaceStatus, 'Loading your workspaces…')
  try {
    const data = await readJson('/api/boing/organizations', { signal: controller.signal })
    if (controller.signal.aborted) return
    if (!Array.isArray(data?.organizations)) throw new Error('invalid_workspaces')
    const organizations = data.organizations.filter(org => org && typeof org.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(org.id) && typeof org.name === 'string')
    if (!organizations.length) {
      text(workspaceStatus, data.truncated === true ? 'No workspaces were found in the first results. Additional workspaces may be unavailable.' : 'No workspaces are available for this account.')
      return
    }
    for (const org of organizations) {
      workspaceRoles.set(org.id, org.role)
      const option = document.createElement('option')
      option.value = org.id
      text(option, org.name)
      workspaceSelect.append(option)
    }
    if (typeof preferredId === 'string' && organizations.some(org => org.id === preferredId)) workspaceSelect.value = preferredId
    workspaceSelect.disabled = false
    text(workspaceStatus, data.truncated === true ? 'Only the first workspace results are shown.' : '')
    void loadProjects(preferredProjectId)
  } catch (error) {
    if (controller.signal.aborted) return
    text(workspaceStatus, messageFor(error))
    retryWorkspaces.hidden = false
  }
}

async function joinWorkspace(event) {
  event.preventDefault()
  if (invitationSubmit.disabled) return
  const token = invitationToken.value.trim()
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    text(invitationStatus, 'Enter the invitation code supplied by your workspace owner.')
    return
  }
  invitationToken.value = ''
  invitationSubmit.disabled = true
  text(invitationStatus, 'Checking your invitation…')
  try {
    const organizationId = await acceptInvitation(token)
    text(invitationStatus, 'Invitation accepted.')
    await loadWorkspaces(organizationId)
  } catch (error) {
    text(invitationStatus, error instanceof ApiError && error.status === 403
      ? 'This invitation is unavailable for your account. Check the code and sign in with the invited email.'
      : 'Could not accept this invitation. Try again or contact your workspace owner.')
  } finally {
    invitationSubmit.disabled = false
  }
}

async function loadProjects(preferredId) {
  clearProjects()
  const organizationId = workspaceSelect.value
  if (!organizationId) return
  workspaceExport.show(organizationId, workspaceRoles.get(organizationId))
  void workspaceMembers.load(organizationId, workspaceRoles.get(organizationId))
  void workspaceInvitations.load(organizationId, workspaceRoles.get(organizationId))
  void workspaceAudit.load(organizationId, workspaceRoles.get(organizationId))
  void projectArchive.load(organizationId, workspaceRoles.get(organizationId))
  createSection.hidden = workspaceRoles.get(organizationId) !== 'owner'
  const controller = new AbortController()
  listController = controller
  projectsStatus.hidden = false
  text(projectsStatus, 'Loading your projects…')
  retryProjects.hidden = true
  try {
    const data = await readJson('/api/boing/projects', { signal: controller.signal, organizationId })
    if (controller.signal.aborted) return
    if (!Array.isArray(data?.projects)) throw new Error('invalid_projects')
    const projects = data.projects.filter(project => project && typeof project.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(project.id) && typeof project.name === 'string')
    if (!projects.length) { text(projectsStatus, 'No projects are available for this account.'); return }
    projectsStatus.hidden = true
    let firstButton, preferredButton
    for (const project of projects) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'project'
      const name = document.createElement('strong')
      const org = document.createElement('span')
      text(name, project.name)
      text(org, project.organization_name)
      button.append(name, org)
      button.addEventListener('click', () => selectProject(project, button))
      projectList.append(button)
      firstButton ??= button
      if (project.id === preferredId) preferredButton = button
    }
    const project = projects.find(item => item.id === preferredId) ?? projects[0]
    void selectProject(project, preferredButton ?? firstButton)
  } catch (error) {
    if (controller.signal.aborted) return
    text(projectsStatus, messageFor(error))
    retryProjects.hidden = false
  }
}

async function createNewProject(event) {
  event.preventDefault()
  const name = createName.value.trim()
  const organizationId = workspaceSelect.value
  if (!name || name.length > 100 || createSubmit.disabled || workspaceRoles.get(organizationId) !== 'owner') return
  const controller = new AbortController()
  createController = controller
  createSubmit.disabled = true
  text(createStatus, 'Creating project…')
  try {
    const project = await createProject(name, { organizationId, signal: controller.signal })
    if (controller.signal.aborted) return
    createName.value = ''
    await loadProjects(project.id)
  } catch (error) {
    if (!controller.signal.aborted) text(createStatus, error instanceof ApiError && error.status === 400 ? 'Enter a valid project name.' : 'Could not create the project. Check your workspace and try again.')
  } finally {
    if (!controller.signal.aborted) createSubmit.disabled = false
  }
}

async function selectProject(project, button) {
  const organizationId = workspaceSelect.value
  if (!organizationId) return
  void projectHistory.load(project.id, organizationId)
  projectArchive.select(project)
  void loadAccess(project.id, organizationId)
  void loadGithub(project, organizationId)
  void loadAi(project.id, organizationId)
  selected = { project, button }
  projectController?.abort()
  exportController?.abort()
  websiteController?.abort()
  renameController?.abort()
  collectionController?.abort()
  collectionRuns.clear()
  collectionSection.hidden = workspaceRoles.get(organizationId) !== 'owner'
  if (!collectionSection.hidden) void collectionRuns.load(project.id, organizationId)
  collectionButton.disabled = true
  text(collectionDescription, 'Checking collection availability…')
  text(collectionStatus, '')
  renameSection.hidden = workspaceRoles.get(organizationId) !== 'owner'
  renameInput.value = project.name
  renameSave.disabled = false
  text(renameStatus, '')
  presentationController?.abort()
  savedPresentation = null
  presentationSettings.hidden = true
  presentationSave.disabled = false
  websiteSave.disabled = false
  websiteSettings.hidden = workspaceRoles.get(organizationId) !== 'owner'
  websiteUrl.value = typeof project.website_url === 'string' ? project.website_url : ''
  text(websiteStatus, '')
  exportButton.disabled = false
  text(exportStatus, '')
  const controller = new AbortController()
  projectController = controller
  for (const item of projectList.children) item.removeAttribute('aria-current')
  button.setAttribute('aria-current', 'true')
  empty.hidden = true
  detail.hidden = false
  text(element('organization'), project.organization_name || 'WORKSPACE')
  text(element('project-title'), project.name)
  text(element('project-meta'), [project.repository, project.website_url].filter(value => typeof value === 'string' && value).join(' · '))
  text(detailStatus, 'Loading the latest stored data…')
  text(presentationStatus, '')
  metrics.replaceChildren()
  const root = `/api/boing/projects/${encodeURIComponent(project.id)}`
  const [snapshot, presentation, sources] = await Promise.allSettled([
    readJson(`${root}/snapshot`, { signal: controller.signal, organizationId }),
    readJson(`${root}/presentation`, { signal: controller.signal, organizationId }),
    readJson(`${root}/sources`, { signal: controller.signal, organizationId }),
  ])
  if (controller.signal.aborted) return
  const sourcesUnavailable = sources.status === 'rejected' && sources.reason instanceof ApiError && sources.reason.status === 404
  const records = sources.status === 'fulfilled' && Array.isArray(sources.value?.sources) ? sources.value.sources : null
  const collectionAvailable = records?.some(source => source?.collectionConfigured === true) === true
  collectionButton.disabled = !collectionAvailable
  text(collectionDescription, collectionAvailable ? 'Request a new collection for configured sources. Results may take a moment.' : 'Collection is not configured for this project.')
  if (sourcesUnavailable && snapshot.status === 'rejected' && snapshot.reason instanceof ApiError && [401, 403].includes(snapshot.reason.status)) {
    text(detailStatus, messageFor(snapshot.reason))
  } else if (records || sourcesUnavailable) {
    const github = records?.find(source => source?.kind === 'github')
    const website = records?.find(source => source?.kind === 'website')
    const useGitHub = github?.available === true && github.data && typeof github.data === 'object'
    const useLegacy = !useGitHub && snapshot.status === 'fulfilled'
    const values = metricCards(useGitHub ? github.data : useLegacy ? snapshot.value?.snapshot : null)
    if (project.website_url) values.push(websiteMetric(website))
    const messages = [sourceStatus(github, 'GitHub')]
    if (useLegacy) messages.push(`Showing legacy GitHub snapshot. ${snapshotFreshness(snapshot.value?.generatedAt)}.`)
    if (project.website_url) messages.push(sourceStatus(website, 'Website'))
    text(detailStatus, messages.join(' '))
    for (const metric of values) {
      const card = document.createElement('article')
      card.className = 'metric'
      const label = document.createElement('h3')
      const value = document.createElement('p')
      label.textContent = metric.label
      value.textContent = metric.value === null ? 'Unavailable' : metric.value.toLocaleString()
      if (metric.value === null) value.className = 'metric-unavailable'
      card.append(label, value)
      metrics.append(card)
    }
  } else {
    // Do not mask authorization or provider failures with previously stored data.
    text(detailStatus, sources.status === 'rejected' ? messageFor(sources.reason) : 'Could not load source records. Try again in a moment.')
  }
  if (presentation.status === 'fulfilled') {
    const record = presentation.value
    if (!record?.presentation || typeof record.presentation !== 'object' || Array.isArray(record.presentation) || !Number.isSafeInteger(record.revision) || record.revision < 0) {
      text(presentationStatus, 'Presentation settings could not be loaded.')
    } else if (record.canEdit !== true) {
      text(presentationStatus, 'Saved presentation settings are available. Only an owner or admin can edit them.')
    } else if (Object.hasOwn(record.presentation, 'verification')) {
      text(presentationStatus, 'This verified presentation cannot be edited here.')
    } else {
      savedPresentation = { presentation: record.presentation, revision: record.revision }
      presentationTitle.value = typeof record.presentation.title === 'string' ? record.presentation.title : ''
      presentationDescription.value = typeof record.presentation.description === 'string' ? record.presentation.description : ''
      presentationSettings.hidden = false
      text(presentationStatus, '')
    }
  } else if (presentation.reason instanceof ApiError && presentation.reason.status === 404) text(presentationStatus, 'No presentation settings are available for this project.')
  else text(presentationStatus, 'Presentation settings could not be loaded.')
}

async function savePresentation(event) {
  event.preventDefault()
  if (!selected || !savedPresentation || presentationSave.disabled || presentationSettings.hidden) return
  const { project } = selected
  const organizationId = workspaceSelect.value
  const presentation = { ...savedPresentation.presentation }
  for (const [key, value] of [['title', presentationTitle.value.trim()], ['description', presentationDescription.value.trim()]]) {
    if (value) presentation[key] = value
    else delete presentation[key]
  }
  const controller = new AbortController()
  presentationController = controller
  presentationSave.disabled = true
  text(presentationStatus, 'Saving presentation…')
  try {
    const result = await updatePresentation(project.id, presentation, savedPresentation.revision, { signal: controller.signal, organizationId })
    if (controller.signal.aborted) return
    savedPresentation = { presentation: result.presentation, revision: result.revision }
    text(presentationStatus, 'Presentation saved.')
  } catch (error) {
    if (controller.signal.aborted) return
    if (error instanceof ApiError && error.status === 409) {
      savedPresentation = null
      text(presentationStatus, 'The presentation changed elsewhere. Refresh the view before saving again.')
    } else text(presentationStatus, messageFor(error))
  } finally {
    if (!controller.signal.aborted) presentationSave.disabled = !savedPresentation
  }
}

async function exportProject() {
  if (!selected || exportButton.disabled) return
  const { project } = selected
  const organizationId = workspaceSelect.value
  const controller = new AbortController()
  exportController = controller
  exportButton.disabled = true
  text(exportStatus, 'Preparing project export…')
  try {
    const data = await readJson(`/api/boing/projects/${encodeURIComponent(project.id)}/export`, { signal: controller.signal, organizationId })
    if (controller.signal.aborted) return
    const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = 'boing-project-export.json'
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    text(exportStatus, 'Your project download is ready.')
  } catch (error) {
    if (controller.signal.aborted) return
    text(exportStatus, error instanceof ApiError && error.status === 413 ? 'This project is too large to export.' : messageFor(error))
  } finally {
    if (!controller.signal.aborted) exportButton.disabled = false
  }
}

async function saveWebsite(event) {
  event.preventDefault()
  if (!selected || websiteSave.disabled || websiteSettings.hidden) return
  const { project, button } = selected
  const organizationId = workspaceSelect.value
  const website = websiteUrl.value.trim() || null
  const controller = new AbortController()
  websiteController = controller
  websiteSave.disabled = true
  text(websiteStatus, 'Saving website…')
  try {
    await updateWebsite(project.id, website, { signal: controller.signal, organizationId })
    if (controller.signal.aborted) return
    project.website_url = website
    websiteController = null
    await selectProject(project, button)
    if (selected?.project === project && workspaceSelect.value === organizationId) text(websiteStatus, 'Website saved. Previous website measurements are unavailable until collected again.')
  } catch (error) {
    if (controller.signal.aborted) return
    text(websiteStatus, error instanceof ApiError && error.status === 400 ? 'Enter a valid public HTTPS website URL.' : messageFor(error))
  } finally {
    if (!controller.signal.aborted) websiteSave.disabled = false
  }
}

async function saveProjectName(event) {
  event.preventDefault()
  if (!selected || renameSave.disabled || renameSection.hidden) return
  const { project, button } = selected
  const organizationId = workspaceSelect.value
  const name = renameInput.value.trim()
  if (!name || name.length > 100) { text(renameStatus, 'Enter a project name of 100 characters or less.'); return }
  const controller = new AbortController()
  renameController = controller
  renameSave.disabled = true
  text(renameStatus, 'Saving name…')
  try {
    const updated = await renameProject(project.id, name, { organizationId, signal: controller.signal })
    if (controller.signal.aborted || selected?.project !== project || workspaceSelect.value !== organizationId) return
    project.name = updated.name
    text(element('project-title'), updated.name)
    text(button.children[0], updated.name)
    renameInput.value = updated.name
    text(renameStatus, 'Name saved.')
  } catch (error) {
    if (!controller.signal.aborted) text(renameStatus, error instanceof ApiError && error.status === 400 ? 'Enter a valid project name.' : messageFor(error))
  } finally {
    if (!controller.signal.aborted) renameSave.disabled = false
  }
}

async function collectNow() {
  if (!selected || collectionButton.disabled || collectionSection.hidden) return
  const { project } = selected
  const organizationId = workspaceSelect.value
  const controller = new AbortController()
  collectionController = controller
  collectionButton.disabled = true
  text(collectionStatus, 'Requesting collection…')
  try {
    await collectProject(project.id, { organizationId, signal: controller.signal })
    if (!controller.signal.aborted && selected?.project === project && workspaceSelect.value === organizationId) {
      text(collectionStatus, 'Collection requested. Refresh the view later to see available results.')
      void collectionRuns.refresh()
    }
  } catch (error) {
    if (!controller.signal.aborted && selected?.project === project && workspaceSelect.value === organizationId) {
      text(collectionStatus, error instanceof ApiError && error.status === 409 ? 'No collection was started. Check the source or try again later.' : error instanceof ApiError && error.status === 503 ? 'Collection is currently unavailable.' : messageFor(error))
    }
  } finally {
    if (!controller.signal.aborted) collectionButton.disabled = false
  }
}

retryProjects.addEventListener('click', loadProjects)
retryWorkspaces.addEventListener('click', () => loadWorkspaces())
workspaceSelect.addEventListener('change', loadProjects)
element('refresh').addEventListener('click', () => { if (selected) void selectProject(selected.project, selected.button) })
exportButton.addEventListener('click', exportProject)
websiteForm.addEventListener('submit', saveWebsite)
renameForm.addEventListener('submit', saveProjectName)
collectionButton.addEventListener('click', collectNow)
presentationForm.addEventListener('submit', savePresentation)
invitationForm.addEventListener('submit', joinWorkspace)
createForm.addEventListener('submit', createNewProject)
const pendingConnection = pendingGithub()
void loadWorkspaces(pendingConnection?.organizationId, pendingConnection?.projectId)
