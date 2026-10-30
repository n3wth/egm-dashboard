export const NETWORK_MESSAGE='Could not reach the server. Check your connection and try again.'
export const TIMEOUT_MESSAGE='The request took too long. Try again.'

// Messages that apply to any dashboard request; `fallback` covers every other status.
export const statusMessage=(status,fallback)=>status===401?'Your session expired. Reload the page to sign in again.':status===429?'Too many requests. Wait a minute and try again.':fallback

// fetch rejects with TypeError when the network fails, response.json() with SyntaxError on a non-JSON body; AbortSignal.timeout rejects with a TimeoutError.
export const failureMessage=(failure,fallback,{timedOut=false}={})=>timedOut||failure?.name==='TimeoutError'?TIMEOUT_MESSAGE:failure instanceof TypeError?NETWORK_MESSAGE:failure instanceof SyntaxError?fallback:failure?.message||fallback

// Retrying cannot help an expired session, a missing permission, or a rate limit.
export const retryableStatus=status=>![401,403,429].includes(status)
