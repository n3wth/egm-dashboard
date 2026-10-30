export function adviceFailure(signal, failure) {
  if (signal?.aborted) {
    return signal.reason === 'timeout'
      ? {tone: 'error', message: 'This took too long and was stopped. Try again.'}
      : {tone: 'note', message: 'Stopped.'}
  }
  const message = typeof failure?.message === 'string' && failure.message.trim() ? failure.message : 'Advice is unavailable right now.'
  return {tone: 'error', message}
}
