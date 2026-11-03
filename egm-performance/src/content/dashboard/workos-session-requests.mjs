const requestSignal=signal=>AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])

export async function getSessionWidgetToken(signal) {
  const response=await fetch('/api/workos-widget-token',{method:'POST',credentials:'same-origin',signal:requestSignal(signal)})
  if(!response.ok)throw Object.assign(Error(response.status===401?'Sign in again to manage your sessions.':'Sessions are temporarily unavailable.'),{status:response.status})
  const value=await response.json()
  if(typeof value?.token!=='string'||!value.token||typeof value.currentSessionId!=='string'||!value.currentSessionId)throw Error('Sessions are temporarily unavailable.')
  return value
}

export async function getAuthenticationSettings(token,signal) {
  const response=await fetch('https://api.workos.com/client/graphql',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:'query AuthenticationSettings { authenticationSettings { mfaEnabled passwordAuthEnabled } }'}),signal:requestSignal(signal),credentials:'omit',cache:'no-store'})
  if(!response.ok)throw Error('Security settings are temporarily unavailable.')
  const data=await response.json(),settings=data?.data?.authenticationSettings
  if(data?.errors?.length||typeof settings?.mfaEnabled!=='boolean'||typeof settings?.passwordAuthEnabled!=='boolean')throw Error('Security settings are temporarily unavailable.')
  return settings
}
