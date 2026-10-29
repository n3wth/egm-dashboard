import test from 'node:test'
import assert from 'node:assert/strict'
import {adviceFailure} from './growth-advice.mjs'

test('a user stop is a note and a timeout stays an error', () => {
  assert.deepEqual(adviceFailure({aborted: true, reason: 'stop'}), {tone: 'note', message: 'Stopped.'})
  assert.deepEqual(adviceFailure({aborted: true, reason: 'timeout'}), {tone: 'error', message: 'This took too long and was stopped. Try again.'})
  assert.equal(adviceFailure({aborted: true}).tone, 'note')
})

test('request failures keep their message', () => {
  assert.deepEqual(adviceFailure({aborted: false}, new Error('Question limit reached. Try again later.')), {tone: 'error', message: 'Question limit reached. Try again later.'})
  assert.equal(adviceFailure({aborted: false}, new Error('   ')).message, 'Advice is unavailable right now.')
})
